import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader } from 'lucide-react';
import './ChatInterface.css';

const ChatInterface = ({ sessionId, onDiscoveryUpdate, currentPhase, onCategoryChange }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [config, setConfig] = useState(null);
  const [askedQuestions, setAskedQuestions] = useState([]);
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
        const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/config-get');
        if (!response.ok) {
          console.error('ChatInterface config-get failed: HTTP', response.status);
          if (!currentCategory) {
            setCurrentCategory('infrastructure');
          }
          return;
        }
        const data = await response.json().catch((err) => {
          console.error('ChatInterface failed to parse config-get response:', err);
          return null;
        });
        if (!data) {
          if (!currentCategory) {
            setCurrentCategory('infrastructure');
          }
          return;
        }
        setConfig(data);
        // Set initial category from config or fallback to infrastructure
        if (data?.config?.categories?.length > 0) {
          setCurrentCategory(data.config.categories[0].id);
        } else if (!currentCategory) {
          setCurrentCategory('infrastructure');
        }
      } catch (error) {
        console.error('Failed to load config, using defaults:', error);
        if (!currentCategory) {
          setCurrentCategory('infrastructure');
        }
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    if (currentCategory && onCategoryChange) {
      onCategoryChange(currentCategory);
    }
  }, [currentCategory, onCategoryChange]);

  useEffect(() => {
    // Initialize with welcome message
    if (messages.length === 0 && sessionId && currentCategory) {
      const categoryName = config?.config?.categories?.find(c => c.id === currentCategory)?.name || currentCategory;
      addMessage({
        role: 'assistant',
        content: `Welcome to the M&A IT Discovery Assistant! I'll help you map out the complete IT infrastructure for the acquisition. Let's start with ${categoryName} discovery.`,
        timestamp: new Date().toISOString()
      });
      
      // Ask first question
      setTimeout(() => {
        askNextQuestion();
      }, 1500);
    }
  }, [sessionId, currentCategory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const addMessage = (message) => {
    setMessages(prev => [...prev, message]);
  };

  const askNextQuestion = (categoryOverride) => {
    const categoryId = categoryOverride || currentCategory;
    if (!categoryId) return;
    
    // Get questions from config or use defaults
    const categoryConfig = config?.config?.categories?.find(c => c.id === categoryId);
    const questions = categoryConfig?.questions || defaultDiscoveryQuestions[categoryId] || [];
    
    if (questions && questions.length > 0) {
      // Find next unasked question
      const categoryKey = categoryId;
      const alreadyAsked = askedQuestions.filter(q => q.category === categoryKey).length;
      
      if (alreadyAsked < questions.length) {
        const nextQuestion = questions[alreadyAsked];
        setAskedQuestions(prev => [...prev, { category: categoryKey, question: nextQuestion }]);
        addMessage({
          role: 'assistant',
          content: nextQuestion,
          category: categoryId,
          timestamp: new Date().toISOString()
        });
      } else {
        // All questions asked, prompt for completion or next topic
        addMessage({
          role: 'assistant',
          content: `We've covered all the ${categoryConfig?.name || categoryId} questions. Is there anything else you'd like to add, or should we move on? (Type 'next' to continue)`,
          category: categoryId,
          timestamp: new Date().toISOString()
        });
      }
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
      
      // Ask next question if available (after user responds)
      if (!data.categoryComplete) {
        setTimeout(() => {
          askNextQuestion();
        }, 500);
      }

      // Check if we should move to next category
      if (data.categoryComplete) {
        // Get categories from config or use defaults
        const categories = config?.config?.categories?.map(c => c.id) || Object.keys(defaultDiscoveryQuestions);
        const currentIndex = categories.indexOf(currentCategory);
        if (currentIndex < categories.length - 1) {
          const nextCatId = categories[currentIndex + 1];
          const nextCatConfig = config?.config?.categories?.find(c => c.id === nextCatId);
          const nextCatName = nextCatConfig?.name || nextCatId;
          setCurrentCategory(nextCatId);
          // Question tracking will automatically reset since we're checking current category
          setTimeout(() => {
            addMessage({
              role: 'assistant',
              content: `Great! Now let's move on to ${nextCatName} discovery.`,
              timestamp: new Date().toISOString()
            });
            // Explicitly ask for the next category's questions so we don't
            // accidentally reuse the previous category from a stale closure.
            askNextQuestion(nextCatId);
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
    if (!currentCategory) return [];
    
    // Get quick actions from config or use defaults
    const categoryConfig = config?.config?.categories?.find(c => c.id === currentCategory);
    if (categoryConfig?.quickActions && categoryConfig.quickActions.length > 0) {
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
        <span>AI Discovery Assistant{currentCategory ? ` - ${config?.config?.categories?.find(c => c.id === currentCategory)?.name || currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1)}` : ''}</span>
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
