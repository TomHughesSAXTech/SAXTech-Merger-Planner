import React, { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import './AdminPanel.css';

const AdminPanel = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('categories');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/admin-config-get');
      const data = await response.json();
      setConfig(data.config || getDefaultConfig());
    } catch (error) {
      console.error('Error loading config:', error);
      setConfig(getDefaultConfig());
    } finally {
      setLoading(false);
    }
  };

  const getDefaultConfig = () => ({
    categories: [
      {
        id: 'infrastructure',
        name: 'Infrastructure',
        description: 'Physical and virtual infrastructure',
        questions: [
          'How many physical servers are currently in use?',
          'What virtualization platforms are in place?',
          'Describe the network topology and connectivity'
        ],
        extractionPrompt: 'Extract structured data about IT infrastructure including server counts, virtualization, network details, storage systems.',
        completionCriteria: {
          minFacts: 3,
          requiredFields: ['physical_servers', 'virtual_infrastructure']
        },
        quickActions: ['Skip to Applications', 'Upload Infrastructure Diagram', 'Import from CSV']
      },
      {
        id: 'application',
        name: 'Applications',
        description: 'Business applications and software',
        questions: [
          'List all critical business applications',
          'What ERP/CRM systems are in use?',
          'Are there any custom-developed applications?'
        ],
        extractionPrompt: 'Extract application inventory including names, vendors, versions, licenses, and dependencies.',
        completionCriteria: {
          minFacts: 3,
          requiredFields: ['critical_apps']
        },
        quickActions: ['Application Inventory Template', 'Dependency Mapping', 'Skip to Data']
      }
    ],
    globalSettings: {
      progressWeights: {
        infrastructure: 0.25,
        application: 0.20,
        data: 0.20,
        security: 0.20,
        communication: 0.15
      },
      aiModel: 'gpt-4-turbo',
      maxContextMessages: 10
    }
  });

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch('https://maonboarding-functions.azurewebsites.net/api/admin-config-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  const addCategory = () => {
    setConfig({
      ...config,
      categories: [
        ...config.categories,
        {
          id: `category_${Date.now()}`,
          name: 'New Category',
          description: '',
          questions: [''],
          extractionPrompt: '',
          completionCriteria: { minFacts: 1, requiredFields: [] },
          quickActions: []
        }
      ]
    });
  };

  const updateCategory = (index, field, value) => {
    const updated = [...config.categories];
    updated[index] = { ...updated[index], [field]: value };
    setConfig({ ...config, categories: updated });
  };

  const deleteCategory = (index) => {
    if (confirm('Delete this category?')) {
      const updated = config.categories.filter((_, i) => i !== index);
      setConfig({ ...config, categories: updated });
    }
  };

  const addQuestion = (categoryIndex) => {
    const updated = [...config.categories];
    updated[categoryIndex].questions.push('');
    setConfig({ ...config, categories: updated });
  };

  const updateQuestion = (categoryIndex, questionIndex, value) => {
    const updated = [...config.categories];
    updated[categoryIndex].questions[questionIndex] = value;
    setConfig({ ...config, categories: updated });
  };

  const deleteQuestion = (categoryIndex, questionIndex) => {
    const updated = [...config.categories];
    updated[categoryIndex].questions.splice(questionIndex, 1);
    setConfig({ ...config, categories: updated });
  };

  const addQuickAction = (categoryIndex) => {
    const updated = [...config.categories];
    updated[categoryIndex].quickActions.push('New Action');
    setConfig({ ...config, categories: updated });
  };

  const updateQuickAction = (categoryIndex, actionIndex, value) => {
    const updated = [...config.categories];
    updated[categoryIndex].quickActions[actionIndex] = value;
    setConfig({ ...config, categories: updated });
  };

  const deleteQuickAction = (categoryIndex, actionIndex) => {
    const updated = [...config.categories];
    updated[categoryIndex].quickActions.splice(actionIndex, 1);
    setConfig({ ...config, categories: updated });
  };

  if (loading) {
    return <div className="admin-panel loading"><RefreshCw className="spin" /> Loading configuration...</div>;
  }

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <Settings size={32} />
        <h1>M&A Discovery Admin Panel</h1>
        <button className="btn-save" onClick={saveConfig} disabled={saving}>
          <Save size={20} />
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>

      <div className="admin-tabs">
        <button 
          className={activeTab === 'categories' ? 'active' : ''} 
          onClick={() => setActiveTab('categories')}
        >
          Categories & Questions
        </button>
        <button 
          className={activeTab === 'extraction' ? 'active' : ''} 
          onClick={() => setActiveTab('extraction')}
        >
          Extraction Logic
        </button>
        <button 
          className={activeTab === 'settings' ? 'active' : ''} 
          onClick={() => setActiveTab('settings')}
        >
          Global Settings
        </button>
      </div>

      <div className="admin-content">
        {activeTab === 'categories' && (
          <div className="categories-tab">
            <div className="tab-header">
              <h2>Discovery Categories</h2>
              <button className="btn-add" onClick={addCategory}>
                <Plus size={20} /> Add Category
              </button>
            </div>

            {config.categories.map((category, catIndex) => (
              <div key={category.id} className="category-card">
                <div className="category-header">
                  <input
                    type="text"
                    className="category-name"
                    value={category.name}
                    onChange={(e) => updateCategory(catIndex, 'name', e.target.value)}
                    placeholder="Category Name"
                  />
                  <button className="btn-delete" onClick={() => deleteCategory(catIndex)}>
                    <Trash2 size={18} />
                  </button>
                </div>

                <input
                  type="text"
                  className="category-id"
                  value={category.id}
                  onChange={(e) => updateCategory(catIndex, 'id', e.target.value)}
                  placeholder="category-id (lowercase, no spaces)"
                />

                <textarea
                  className="category-description"
                  value={category.description}
                  onChange={(e) => updateCategory(catIndex, 'description', e.target.value)}
                  placeholder="Category description"
                  rows="2"
                />

                <div className="questions-section">
                  <div className="section-header">
                    <h3>Questions</h3>
                    <button className="btn-add-small" onClick={() => addQuestion(catIndex)}>
                      <Plus size={16} /> Add Question
                    </button>
                  </div>
                  {category.questions.map((question, qIndex) => (
                    <div key={qIndex} className="question-row">
                      <input
                        type="text"
                        value={question}
                        onChange={(e) => updateQuestion(catIndex, qIndex, e.target.value)}
                        placeholder="Enter discovery question"
                      />
                      <button 
                        className="btn-delete-small" 
                        onClick={() => deleteQuestion(catIndex, qIndex)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="actions-section">
                  <div className="section-header">
                    <h3>Quick Actions</h3>
                    <button className="btn-add-small" onClick={() => addQuickAction(catIndex)}>
                      <Plus size={16} /> Add Action
                    </button>
                  </div>
                  {category.quickActions.map((action, aIndex) => (
                    <div key={aIndex} className="action-row">
                      <input
                        type="text"
                        value={action}
                        onChange={(e) => updateQuickAction(catIndex, aIndex, e.target.value)}
                        placeholder="Action button text"
                      />
                      <button 
                        className="btn-delete-small" 
                        onClick={() => deleteQuickAction(catIndex, aIndex)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'extraction' && (
          <div className="extraction-tab">
            <h2>AI Extraction Logic</h2>
            <p className="tab-description">
              Configure how OpenAI extracts structured data from user responses
            </p>

            {config.categories.map((category, catIndex) => (
              <div key={category.id} className="extraction-card">
                <h3>{category.name}</h3>
                
                <label>Extraction Prompt</label>
                <textarea
                  value={category.extractionPrompt}
                  onChange={(e) => updateCategory(catIndex, 'extractionPrompt', e.target.value)}
                  placeholder="Describe what data to extract from user responses..."
                  rows="4"
                />

                <label>Completion Criteria</label>
                <div className="completion-criteria">
                  <div className="criteria-field">
                    <label>Minimum Facts Required</label>
                    <input
                      type="number"
                      value={category.completionCriteria.minFacts}
                      onChange={(e) => updateCategory(catIndex, 'completionCriteria', {
                        ...category.completionCriteria,
                        minFacts: parseInt(e.target.value)
                      })}
                      min="1"
                    />
                  </div>
                  <div className="criteria-field">
                    <label>Required Fields (comma-separated)</label>
                    <input
                      type="text"
                      value={category.completionCriteria.requiredFields.join(', ')}
                      onChange={(e) => updateCategory(catIndex, 'completionCriteria', {
                        ...category.completionCriteria,
                        requiredFields: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                      })}
                      placeholder="e.g., physical_servers, virtual_infrastructure"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-tab">
            <h2>Global Settings</h2>

            <div className="settings-card">
              <h3>Progress Weights</h3>
              <p>How much each category contributes to overall progress (must sum to 1.0)</p>
              {config.categories.map((category, catIndex) => (
                <div key={category.id} className="weight-row">
                  <label>{category.name}</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={config.globalSettings.progressWeights[category.id] || 0}
                    onChange={(e) => setConfig({
                      ...config,
                      globalSettings: {
                        ...config.globalSettings,
                        progressWeights: {
                          ...config.globalSettings.progressWeights,
                          [category.id]: parseFloat(e.target.value)
                        }
                      }
                    })}
                  />
                </div>
              ))}
            </div>

            <div className="settings-card">
              <h3>AI Configuration</h3>
              <div className="setting-field">
                <label>OpenAI Model</label>
                <select
                  value={config.globalSettings.aiModel}
                  onChange={(e) => setConfig({
                    ...config,
                    globalSettings: { ...config.globalSettings, aiModel: e.target.value }
                  })}
                >
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>
              <div className="setting-field">
                <label>Max Context Messages</label>
                <input
                  type="number"
                  value={config.globalSettings.maxContextMessages}
                  onChange={(e) => setConfig({
                    ...config,
                    globalSettings: { ...config.globalSettings, maxContextMessages: parseInt(e.target.value) }
                  })}
                  min="1"
                  max="50"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
