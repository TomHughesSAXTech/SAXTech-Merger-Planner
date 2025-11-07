import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader } from 'lucide-react';
import './ChatInterface.css';

const ChatInterface = ({ sessionId, onDiscoveryUpdate, currentPhase }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentCategory, setCurrentCategory] = useState('infrastructure');
  const [config, setConfig] = useState(null);
  const messagesEndRef = useRef(null);

  // Default questions (fallback if config not available)
  const defaultDiscoveryQuestions = {
    infrastructure: [
      "How many physical servers are currently in use?",
      "What virtualization platform is being used (VMware, Hyper-V, etc.)?",
      "Describe the network topology and key network devices",
      "What is the current storage infrastructure?",
      "Are there any legacy systems that require special attention?"
    ],
    application: [
      "List all critical business applications",
      "What ERP/CRM systems are in use?",
      "Are there any custom-developed applications?",
      "What are the application dependencies and integrations?",
      "How are applications currently licensed?"
    ],
    data: [
      "What database systems are in use (SQL Server, Oracle, etc.)?",
      "Total data volume that needs to be migrated?",
      "What is the current backup and recovery strategy?",
      "Are there any data retention or compliance requirements?",
      "How is unstructured data currently stored?"
    ],
    security: [
      "What firewall and security appliances are in place?",
      "Are there any compliance requirements (HIPAA, SOX, etc.)?",
      "How is identity and access management handled?",
      "What are the current security policies and procedures?",
      "Any security incidents or concerns to be aware of?"
    ],
    communication: [
      "What email system is currently in use?",
      "Describe the phone system and requirements",
      "What collaboration tools are being used?",
      "How many users need to be migrated?",
      "Any special communication requirements?"
    ]
  };

  useEffect(() => {
    // Load configuration on mount
    const loadConfig = async () => {
      try {
        const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/admin-config-get');
        if (response.ok) {
          const data = await response.json();
          setConfig(data);
        }
      } catch (error) {
        console.error('Failed to load config, using defaults:', error);
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    // Initialize with welcome message
    if (messages.length === 0 && sessionId) {
      addMessage({
        role: 'assistant',
        content: `Welcome to the M&A IT Discovery Assistant! I'll help you map out the complete IT infrastructure for the acquisition. Let's start with ${currentCategory} discovery.`,
        timestamp: new Date().toISOString()
      });
      
      // Ask first question
      setTimeout(() => {
        askNextQuestion();
      }, 1500);
    }
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const addMessage = (message) => {
    setMessages(prev => [...prev, message]);
  };

  const askNextQuestion = () => {
    // Get questions from config or use defaults
    const categoryConfig = config?.categories?.find(c => c.id === currentCategory);
    const questions = categoryConfig?.questions || defaultDiscoveryQuestions[currentCategory];
    
    if (questions && questions.length > 0) {
      const nextQuestion = questions[0]; // In production, track which questions have been asked
      addMessage({
        role: 'assistant',
        content: nextQuestion,
        category: currentCategory,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    addMessage(userMessage);
    setInput('');
    setIsTyping(true);

    try {
      // Send to Azure Function for processing
                const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/chat-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: input,
          category: currentCategory,
          context: messages.slice(-10) // Last 10 messages for context
        })
      });

      const data = await response.json();

      // Add AI response
      addMessage({
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString()
      });

      // If discovery data was extracted, update the parent
      if (data.discoveryData) {
        onDiscoveryUpdate(currentCategory, data.discoveryData);
      }

      // Check if we should move to next category
      if (data.categoryComplete) {
        // Get categories from config or use defaults
        const categories = config?.categories?.map(c => c.id) || Object.keys(defaultDiscoveryQuestions);
        const currentIndex = categories.indexOf(currentCategory);
        if (currentIndex < categories.length - 1) {
          setCurrentCategory(categories[currentIndex + 1]);
          setTimeout(() => {
            addMessage({
              role: 'assistant',
              content: `Great! Now let's move on to ${categories[currentIndex + 1]} discovery.`,
              timestamp: new Date().toISOString()
            });
            askNextQuestion();
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      addMessage({
        role: 'assistant',
        content: 'I encountered an error processing your response. Please try again.',
        error: true,
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getQuickActions = () => {
    // Get quick actions from config or use defaults
    const categoryConfig = config?.categories?.find(c => c.id === currentCategory);
    if (categoryConfig?.quickActions) {
      return categoryConfig.quickActions;
    }
    
    // Default quick actions
    switch (currentCategory) {
      case 'infrastructure':
        return ['Skip to Applications', 'Upload Infrastructure Diagram', 'Import from CSV'];
      case 'application':
        return ['Application Inventory Template', 'Dependency Mapping', 'Skip to Data'];
      case 'data':
        return ['Data Classification', 'Migration Calculator', 'Skip to Security'];
      case 'security':
        return ['Security Assessment', 'Compliance Checklist', 'Skip to Communication'];
      case 'communication':
        return ['User Count Calculator', 'License Assessment', 'Generate Plan'];
      default:
        return [];
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <Bot className="chat-icon" />
        <span>AI Discovery Assistant - {currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1)}</span>
      </div>

      <div className="messages-container">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role} ${message.error ? 'error' : ''}`}>
            <div className="message-icon">
              {message.role === 'assistant' ? <Bot size={20} /> : <User size={20} />}
            </div>
            <div className="message-content">
              <div className="message-text">{message.content}</div>
              <div className="message-time">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="message assistant typing">
            <div className="message-icon"><Bot size={20} /></div>
            <div className="message-content">
              <Loader className="typing-indicator" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="quick-actions">
        {getQuickActions().map((action, index) => (
          <button 
            key={index}
            className="quick-action-btn"
            onClick={() => setInput(action)}
          >
            {action}
          </button>
        ))}
      </div>

      <div className="chat-input-container">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your response or ask a question..."
          rows="2"
        />
        <button 
          className="send-button"
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
};

export default ChatInterface;
