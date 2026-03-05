const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');

const HARD_CODED_FALLBACK_ENDPOINT = 'https://client-fcs.cognitiveservices.azure.com/';
const HARD_CODED_FALLBACK_DEPLOYMENT = 'gpt-5.2-chat';

const normalizeEndpoint = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'string') return null;
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.endsWith('/') ? withProtocol : `${withProtocol}/`;
};

const dedupe = (values) => {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
};

function resolveOpenAISettings(configData = {}, env = process.env) {
  const globalSettings = configData?.globalSettings || {};
  const openAiSettings = globalSettings?.openAi || {};

  const selectedSlot = (openAiSettings.keySlot || 'primary').toLowerCase();
  const primaryKey = env.AZURE_OPENAI_KEY_PRIMARY || env.AZURE_OPENAI_KEY || '';
  const secondaryKey = env.AZURE_OPENAI_KEY_SECONDARY || '';
  const preferredKey = selectedSlot === 'secondary' ? secondaryKey : primaryKey;
  const alternateKey = selectedSlot === 'secondary' ? primaryKey : secondaryKey;
  const key = preferredKey || alternateKey;

  if (!key) {
    throw new Error('No Azure OpenAI key configured. Set AZURE_OPENAI_KEY or AZURE_OPENAI_KEY_PRIMARY.');
  }

  const endpointCandidates = dedupe([
    normalizeEndpoint(openAiSettings.endpoint),
    normalizeEndpoint(env.AZURE_OPENAI_ENDPOINT),
    normalizeEndpoint(env.AZURE_OPENAI_ENDPOINT_PRIMARY),
    normalizeEndpoint(HARD_CODED_FALLBACK_ENDPOINT),
  ]).filter(Boolean);

  if (!endpointCandidates.length) {
    throw new Error('No Azure OpenAI endpoint configured.');
  }

  const deployment = globalSettings.aiModel || env.AZURE_OPENAI_DEPLOYMENT || HARD_CODED_FALLBACK_DEPLOYMENT;
  const fallbackDeployment = env.AZURE_OPENAI_DEPLOYMENT || HARD_CODED_FALLBACK_DEPLOYMENT;

  return {
    key,
    endpointCandidates,
    deployment,
    fallbackDeployment,
  };
}

function shouldTryAnotherEndpoint(error) {
  const message = (error?.message || '').toLowerCase();
  return (
    message.includes('invalid subscription key') ||
    message.includes('wrong api endpoint') ||
    message.includes('resource not found') ||
    message.includes('name or service not known') ||
    message.includes('enotfound') ||
    message.includes('unauthorized')
  );
}

function shouldRetryWithFallbackDeployment(error) {
  const message = (error?.message || '').toLowerCase();
  return message.includes('deployment') && message.includes('does not exist');
}

async function getChatCompletionsWithFallback({
  settings,
  messages,
  options = {},
  context,
  label = 'OpenAI call',
}) {
  const { key, endpointCandidates, deployment, fallbackDeployment } = settings;
  let lastError = null;

  for (const endpoint of endpointCandidates) {
    const client = new OpenAIClient(endpoint, new AzureKeyCredential(key));
    try {
      const primaryDeployment = deployment || fallbackDeployment;
      return await client.getChatCompletions(primaryDeployment, messages, options);
    } catch (error) {
      lastError = error;

      if (
        shouldRetryWithFallbackDeployment(error) &&
        fallbackDeployment &&
        fallbackDeployment !== deployment
      ) {
        try {
          context?.log?.warn?.(
            `[${label}] Deployment "${deployment}" missing on ${endpoint}; retrying with "${fallbackDeployment}".`
          );
          return await client.getChatCompletions(fallbackDeployment, messages, options);
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }

      if (shouldTryAnotherEndpoint(error)) {
        context?.log?.warn?.(`[${label}] Endpoint ${endpoint} failed; trying next candidate.`);
        continue;
      }

      break;
    }
  }

  throw lastError || new Error(`${label} failed: unknown OpenAI error.`);
}

function parseJsonResponse(content) {
  if (typeof content !== 'string') {
    throw new Error('OpenAI response content is not a string.');
  }

  let text = content.trim();
  if (!text) {
    throw new Error('OpenAI response content is empty.');
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    text = fencedMatch[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    // Keep trying with bracket extraction below.
  }

  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    const slice = text.slice(firstObject, lastObject + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      // fall through
    }
  }

  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) {
    const slice = text.slice(firstArray, lastArray + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      // fall through
    }
  }

  throw new Error('Failed to parse JSON from OpenAI response.');
}

module.exports = {
  resolveOpenAISettings,
  getChatCompletionsWithFallback,
  parseJsonResponse,
};
