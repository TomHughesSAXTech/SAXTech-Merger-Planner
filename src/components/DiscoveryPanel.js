import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import './DiscoveryPanel.css';

const DiscoveryPanel = ({ discoveryData, currentPhase, config, onEdit }) => {
  const [expandedSections, setExpandedSections] = useState({});
  const [editing, setEditing] = useState(null); // { categoryId, key }
  const [editValue, setEditValue] = useState('');

  // Prefer dynamic categories from config so this panel reflects the actual
  // discovery sections defined in the admin UI (e.g., general, server, workstation,
  // etc.). Fall back to the original static categories if config is missing.
  const configuredCategories = config?.config?.categories?.map((c) => ({
    id: c.id,
    label: c.name || c.id.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
    icon: '•',
  })) || [];

  const fallbackCategories = [
    { id: 'infrastructure', label: 'Infrastructure', icon: '🖥️' },
    { id: 'application', label: 'Applications', icon: '📱' },
    { id: 'data', label: 'Data Systems', icon: '💾' },
    { id: 'security', label: 'Security', icon: '🔒' },
    { id: 'communication', label: 'Communications', icon: '📞' },
  ];

  const categories = configuredCategories.length > 0 ? configuredCategories : fallbackCategories;

  const getStatusIcon = (category) => {
    if (discoveryData[category] && Object.keys(discoveryData[category]).length > 0) {
      return <CheckCircle size={16} className="status-complete" />;
    } else if (currentPhase === category) {
      return <Clock size={16} className="status-active" />;
    } else {
      return <AlertCircle size={16} className="status-pending" />;
    }
  };

  const toggleSection = (categoryId) => {
    setExpandedSections(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId]
    }));
  };

  const startEditing = (categoryId, key, value) => {
    setEditing({ categoryId, key });
    setEditValue(value != null ? String(value) : '');
  };

  const cancelEditing = () => {
    setEditing(null);
    setEditValue('');
  };

  const saveEditing = () => {
    if (editing && onEdit) {
      onEdit(editing.categoryId, editing.key, editValue);
    }
    cancelEditing();
  };

  const formatDiscoveryItem = (categoryId, key, value) => {
    // Format the key to be more readable
    const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    
    // Handle different value types
    if (typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={key} className="discovery-item nested">
          <div className="item-key">{formattedKey}:</div>
          <div className="nested-items">
            {Object.entries(value).map(([k, v]) => formatDiscoveryItem(categoryId, k, v))}
          </div>
        </div>
      );
    } else if (Array.isArray(value)) {
      return (
        <div key={key} className="discovery-item">
          <div className="item-key">{formattedKey}:</div>
          <ul className="item-list">
            {value.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      );
    } else {
      const isEditing =
        editing && editing.categoryId === categoryId && editing.key === key;

      return (
        <div key={key} className="discovery-item">
          <span className="item-key">{formattedKey}:</span>
          {isEditing ? (
            <input
              className="item-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEditing}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEditing();
                if (e.key === 'Escape') cancelEditing();
              }}
              autoFocus
            />
          ) : (
            <span
              className="item-value editable"
              onClick={() => startEditing(categoryId, key, value)}
            >
              {value}
            </span>
          )}
        </div>
      );
    }
  };

  const calculateProgress = () => {
    if (!categories.length) return 0;

    const completedCategories = categories.filter(
      (cat) => discoveryData[cat.id] && Object.keys(discoveryData[cat.id]).length > 0
    ).length;
    return (completedCategories / categories.length) * 100;
  };

  return (
    <div className="discovery-panel">
      <div className="panel-header">
        <h3>Discovery Progress</h3>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${calculateProgress()}%` }}
          />
        </div>
        <span className="progress-text">{Math.round(calculateProgress())}% Complete</span>
      </div>

      <div className="discovery-sections">
        {categories.map(category => (
          <div key={category.id} className="discovery-section">
            <div 
              className={`section-header ${currentPhase === category.id ? 'active' : ''}`}
              onClick={() => toggleSection(category.id)}
            >
              <div className="section-title">
                <span className="section-icon">{category.icon}</span>
                <span>{category.label}</span>
                {getStatusIcon(category.id)}
              </div>
              <div className="section-toggle">
                {expandedSections[category.id] ? 
                  <ChevronDown size={16} /> : 
                  <ChevronRight size={16} />
                }
              </div>
            </div>

            {expandedSections[category.id] && (
              <div className="section-content">
                {discoveryData[category.id] ? (
                  <div className="discovery-items">
                    {Object.entries(discoveryData[category.id]).map(([key, value]) => 
                      formatDiscoveryItem(category.id, key, value)
                    )}
                  </div>
                ) : (
                  <div className="no-data">
                    {currentPhase === category.id ? 
                      'Currently collecting information...' : 
                      'No data collected yet'
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel-footer">
        <div className="summary-stats">
          <div className="stat">
            <span className="stat-label">Total Items:</span>
            <span className="stat-value">
              {Object.values(discoveryData).reduce((acc, cat) => 
                acc + Object.keys(cat || {}).length, 0
              )}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Current Phase:</span>
            <span className="stat-value">{currentPhase}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiscoveryPanel;
