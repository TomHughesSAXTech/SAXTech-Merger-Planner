import React, { useState } from 'react';
import './FileUploadPanel.css';
const API_BASE = '/api';

const FileUploadPanel = ({ sessionId, onDiscoveryMerge }) => {
  const [uploads, setUploads] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');

  const updateUploadStatus = (name, status) => {
    setUploads((prev) =>
      prev.map((u) => (u.name === name ? { ...u, status } : u))
    );
  };

  const ingestContent = async ({ fileName, content, sourceType }) => {
    const response = await fetch(`${API_BASE}/file-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        fileName,
        content,
        sourceType,
      }),
    });

    const data = await response.json().catch(() => null);
    if (response.ok && data?.discoveryData && onDiscoveryMerge) {
      onDiscoveryMerge(data.discoveryData, {
        sourceType: data.sourceType || sourceType,
        updatedCategories: Array.isArray(data.updatedCategories) ? data.updatedCategories : [],
        completionHints: data.completionHints || {},
        fileName,
      });
    }

    return { response, data };
  };

  const handleFiles = async (files, sourceType = 'supplemental') => {
    if (!sessionId) return;
    const fileArray = Array.from(files || []);
    if (!fileArray.length) return;

    setIsUploading(true);

    for (const file of fileArray) {
      setUploads((prev) => [
        ...prev,
        { name: file.name, sourceType, status: 'uploading' },
      ]);

      try {
        const text = await file.text();
        const { response } = await ingestContent({
          fileName: file.name,
          content: text,
          sourceType,
        });
        updateUploadStatus(file.name, response.ok ? 'done' : 'error');
      } catch (error) {
        console.error('File upload failed:', error);
        updateUploadStatus(file.name, 'error');
      }
    }

    setIsUploading(false);
  };

  const handleTranscriptFileChange = (e) => {
    handleFiles(e.target.files, 'transcript');
    e.target.value = '';
  };

  const handleSupplementalFileChange = (e) => {
    handleFiles(e.target.files, 'supplemental');
    e.target.value = '';
  };

  const handleTranscriptPasteIngest = async () => {
    if (!sessionId || !transcriptText.trim() || isUploading) return;
    const pseudoFileName = 'pasted-call-transcript.txt';
    setIsUploading(true);
    setUploads((prev) => [
      ...prev,
      { name: pseudoFileName, sourceType: 'transcript', status: 'uploading' },
    ]);

    try {
      const { response } = await ingestContent({
        fileName: pseudoFileName,
        content: transcriptText,
        sourceType: 'transcript',
      });
      updateUploadStatus(pseudoFileName, response.ok ? 'done' : 'error');
      if (response.ok) {
        setTranscriptText('');
      }
    } catch (error) {
      console.error('Transcript ingest failed:', error);
      updateUploadStatus(pseudoFileName, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="file-upload-panel">
      <div className="file-upload-block transcript-block">
        <div className="file-upload-header">Call Transcript Import</div>
        <p className="file-upload-help">
          Import or paste interview transcript text and we will parse it to auto-fill relevant discovery
          question areas.
        </p>
        <input
          type="file"
          accept=".txt,.md,.csv,.rtf"
          onChange={handleTranscriptFileChange}
          disabled={!sessionId || isUploading}
        />
        <textarea
          className="transcript-textarea"
          placeholder="Paste call transcript text here..."
          value={transcriptText}
          onChange={(e) => setTranscriptText(e.target.value)}
          disabled={!sessionId || isUploading}
          rows={4}
        />
        <button
          className="transcript-ingest-btn"
          onClick={handleTranscriptPasteIngest}
          disabled={!sessionId || isUploading || !transcriptText.trim()}
        >
          Parse Pasted Transcript
        </button>
      </div>

      <div className="file-upload-block supplemental-block">
        <div className="file-upload-header">Supplemental File Ingestion</div>
        <p className="file-upload-help">
          Upload discovery exports (inventories, network docs, spreadsheets) to merge additional facts.
        </p>
        <input
          type="file"
          multiple
          onChange={handleSupplementalFileChange}
          disabled={!sessionId || isUploading}
        />
      </div>
      <div className="file-upload-list">
        {uploads.map((u) => (
          <div key={u.name} className={`file-upload-item ${u.status}`}>
            <span className="file-name">
              {u.name}
              {u.sourceType === 'transcript' ? ' (transcript)' : ''}
            </span>
            <span className="file-status">{u.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileUploadPanel;
