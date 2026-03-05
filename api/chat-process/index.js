const { CosmosClient } = require('@azure/cosmos');
const {
  resolveOpenAISettings,
  getChatCompletionsWithFallback,
  parseJsonResponse,
} = require('../src/openai');

const defaultCategoryPrompts = {
  infrastructure:
    'Ask about network topology, servers, storage, virtualization platforms, and legacy systems. Extract key infrastructure details.',
  application:
    'Ask about business applications, ERP/CRM systems, custom applications, dependencies, integration points, and licensing.',
  data:
    'Ask about database systems, data volume, backup/recovery, compliance requirements, and unstructured data locations.',
  security:
    'Ask about firewalls, endpoint protection, MFA, compliance frameworks, identity/security policies, and incident history.',
  communication:
    'Ask about email systems, phone systems, collaboration tools, and user migration requirements.',
};

function buildFallbackAcknowledgement(message, category) {
  const text = String(message || '').trim();
  const short = text.length > 220 ? `${text.slice(0, 217)}...` : text;
  const cleanCategory = String(category || 'current').replace(/_/g, ' ');
  if (!short) {
    return `Acknowledged. I captured your ${cleanCategory} discovery details.`;
  }
  return `Acknowledged for ${cleanCategory}: ${short}`;
}

function extractFactsHeuristically(message, category) {
  const text = String(message || '');
  const result = {};
  const normalizedCategory = String(category || '').toLowerCase();

  const companyMatch = text.match(/(?:company(?:\s+name)?(?:\s+is)?|organization(?:\s+is)?|client(?:\s+is)?)\s*[:\-]?\s*([A-Z][A-Za-z0-9&'.,\- ]{2,80})/i);
  const usersMatch = text.match(/(\d{1,5})\s+(?:users|employees|staff)\b/i);
  const sitesMatch = text.match(/(\d{1,4})\s+(?:offices?|sites?|locations?)\b/i);
  const serversMatch = text.match(/(\d{1,5})\s+(?:physical\s+|virtual\s+)?servers?\b/i);

  if (companyMatch && companyMatch[1]) {
    result.company_name = companyMatch[1].trim().replace(/[.,;:]+$/, '');
  }
  if (usersMatch) {
    result.total_users = Number(usersMatch[1]);
  }
  if (sitesMatch) {
    result.sites = Number(sitesMatch[1]);
  }
  if (serversMatch) {
    result.server_count = Number(serversMatch[1]);
  }
  if (/microsoft\s*365|office\s*365/i.test(text)) {
    result.productivity_suite = 'Microsoft 365';
  }
  if (/remote[-\s]?capable|remote\s+work|hybrid/i.test(text)) {
    result.work_model = 'hybrid_or_remote';
  }

  if (!Object.keys(result).length) {
    return {};
  }

  if (normalizedCategory === 'server') {
    return {
      server_count: result.server_count || undefined,
    };
  }
  if (normalizedCategory === 'workstation') {
    return {
      total_users: result.total_users || undefined,
      work_model: result.work_model || undefined,
    };
  }
  if (normalizedCategory === 'network') {
    return {
      sites: result.sites || undefined,
    };
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

async function loadConfig(cosmosClient) {
  try {
    const database = cosmosClient.database('MAOnboarding');
    const container = database.container('Configurations');
    const { resource: config } = await container.item('discovery_config', 'discovery_config').read();
    return config?.data || null;
  } catch {
    return null;
  }
}

module.exports = async function (context, req) {
  try {
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
    const cosmosKey = process.env.COSMOS_KEY;
    if (!cosmosEndpoint || !cosmosKey) {
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Cosmos DB configuration missing' },
      };
      return;
    }

    const body = req.body || {};
    const { sessionId, message, category, context: conversationContext } = body;
    if (!sessionId || !message || !category) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId, category, and message are required' },
      };
      return;
    }

    const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    const database = cosmosClient.database('MAOnboarding');
    const sessions = database.container('Sessions');

    const { resource: session } = await sessions.item(sessionId, sessionId).read();
    if (!session) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Session not found' },
      };
      return;
    }

    if (!Array.isArray(session.messages)) {
      session.messages = [];
    }
    if (!session.discoveryData || typeof session.discoveryData !== 'object') {
      session.discoveryData = {};
    }

    const config = await loadConfig(cosmosClient);
    const categoryConfig = config?.categories?.find((c) => c.id === category);
    const settings = resolveOpenAISettings(config || {});
    const maxContextMessages = config?.globalSettings?.maxContextMessages || 10;

    const basePrompt =
      categoryConfig?.extractionPrompt ||
      defaultCategoryPrompts[category] ||
      'Collect structured facts that matter to M&A migration planning.';

    const systemPrompt = `You are a Senior Systems and Network Architect with 30+ years of professional services scoping experience for managed services and project-based consulting.
You are supporting an M&A IT onboarding discovery process and must capture facts that feed a migration-ready project plan, network diagram, timeline, constraints, and SOP.
Category focus: ${basePrompt}

CRITICAL OUTPUT RULES:
- Reply with a concise acknowledgement (1-3 sentences) summarizing concrete technical facts from the user's latest response.
- Use specific nouns and quantities (platform names, device counts, versions, locations, vendors, integrations, constraints).
- Do not ask follow-up questions here; the orchestrator controls question flow.
- Keep tone professional and architect-level.`;

    const recentContext = Array.isArray(conversationContext)
      ? conversationContext.slice(-maxContextMessages)
      : [];

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentContext.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    let response = buildFallbackAcknowledgement(message, category);
    try {
      const completion = await getChatCompletionsWithFallback({
        settings,
        messages,
        options: { maxTokens: 1500 },
        context,
        label: 'chat-process main response',
      });
      response =
        completion?.choices?.[0]?.message?.content?.trim() ||
        response;
    } catch (error) {
      context.log.warn('chat-process main response fallback triggered:', error.message);
    }

    session.messages.push(
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: response, timestamp: new Date().toISOString() }
    );

    let discoveryData = null;
    let categoryComplete = false;
    const mergeCategoryFacts = (facts) => {
      if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.keys(facts).length === 0) {
        return;
      }
      session.discoveryData[category] = {
        ...(session.discoveryData[category] || {}),
        ...facts,
      };
      discoveryData = session.discoveryData[category];
    };

    const extractionPrompt = `Extract structured M&A IT discovery facts for category "${category}".
Return ONLY valid JSON object with snake_case keys and category-relevant fields.
If no new facts are present, return {}.

Preferred category mapping:
- general: company_name, primary_poc{name,email,phone,role}, total_users, sites, constraints, timeline_targets
- server: server_count, servers[{name,role,os,location,type}], virtualization_platform, cloud_provider
- workstation: workstation_count, workstation_types, os_versions, domain_join_type, shared_devices
- security: firewall_brand, firewall_model, edr_vendor, email_filter, mfa_enabled, compliance_requirements
- backup: backup_platform, backup_frequency, backup_retention, backup_scope, total_backup_volume
- rmm: rmm_vendor, ticketing_system, sla_details, patching_method
- applications: applications[{name,vendor,type,sso_enabled}], document_storage, accounting_platform, tax_platform
- telephony: phone_provider, phone_system_type, phone_numbers_to_port, call_routing
- vendor: msps[{name,services,contract_end}], vendor_partnerships
- network: isp_primary, isp_secondary, vpn_brand, vpn_type, switch_brands, switch_count, wifi_system, wifi_ap_count, sites[{name,type,address}]`;

    try {
      const extractionCompletion = await getChatCompletionsWithFallback({
        settings,
        messages: [
          { role: 'system', content: extractionPrompt },
          {
            role: 'user',
            content: `Latest response: ${message}\n\nRecent context: ${recentContext
              .map((m) => m.content)
              .join(' ')}`,
          },
        ],
        options: { maxTokens: 1200 },
        context,
        label: 'chat-process discovery extraction',
      });

      const extracted = parseJsonResponse(extractionCompletion?.choices?.[0]?.message?.content || '{}');
      mergeCategoryFacts(extracted);
    } catch (error) {
      context.log.warn('chat-process extraction fallback triggered:', error.message);
      mergeCategoryFacts(extractFactsHeuristically(message, category));
    }

    const completionCriteria = categoryConfig?.completionCriteria;
    const normalizedMessage = String(message).toLowerCase();
    const userSignaledDone =
      normalizedMessage.includes('done') ||
      normalizedMessage.includes('complete') ||
      normalizedMessage.includes('finished') ||
      normalizedMessage.includes('next') ||
      normalizedMessage.includes('move on');

    if (completionCriteria) {
      const factCount = Object.keys(session.discoveryData[category] || {}).length;
      const requiredFields = Array.isArray(completionCriteria.requiredFields)
        ? completionCriteria.requiredFields
        : [];
      const hasRequiredFields = requiredFields.every((field) => session.discoveryData[category]?.[field]);
      const minFacts = Number.isFinite(completionCriteria.minFacts)
        ? completionCriteria.minFacts
        : 1;

      if (
        userSignaledDone &&
        hasRequiredFields &&
        (factCount >= minFacts || (factCount === 0 && requiredFields.length === 0))
      ) {
        categoryComplete = true;
      }
    } else if (userSignaledDone) {
      categoryComplete = true;
    }

    await sessions.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        response,
        discoveryData,
        categoryComplete,
      },
    };
  } catch (error) {
    context.log.error('Error processing chat:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to process chat message', details: error.message },
    };
  }
};
