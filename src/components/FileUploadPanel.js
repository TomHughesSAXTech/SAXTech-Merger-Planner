import React, { useState } from 'react';
import './FileUploadPanel.css';

const FileUploadPanel = ({ sessionId, onDiscoveryMerge }) => {
  const [uploads, setUploads] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFiles = async (files) => {
    if (!sessionId) return;
    const fileArray = Array.from(files || []);
    if (!fileArray.length) return;

    setIsUploading(true);

    for (const file of fileArray) {
      setUploads((prev) => [
        ...prev,
        { name: file.name, status: 'uploading' },
      ]);

      try {
        const text = await file.text();
        const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/file-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            fileName: file.name,
            content: text,
          })
        });

        const data = await response.json();
        if (response.ok && data.discoveryData && onDiscoveryMerge) {
          onDiscoveryMerge(data.discoveryData);
        }

        setUploads((prev) => prev.map((u) =>
          u.name === file.name ? { ...u, status: response.ok ? 'done' : 'error' } : u
        ));
      } catch (error) {
        console.error('File upload failed:', error);
        setUploads((prev) => prev.map((u) =>
          u.name === file.name ? { ...u, status: 'error' } : u
        ));
      }
    }

    setIsUploading(false);
  };

  const onInputChange = (e) => {
    handleFiles(e.target.files);
  };

  return (
    <div className="file-upload-panel">
      <div className="file-upload-header">File Ingestion</div>
      <p className="file-upload-help">
        Upload discovery exports (spreadsheets, inventories, network docs). We'll parse and map them
        into the appropriate discovery sections.
      </p>
      <input
        type="file"
        multiple
        onChange={onInputChange}
        disabled={!sessionId || isUploading}
      />
      <div className="file-upload-list">
        {uploads.map((u) => (
          <div key={u.name} className={`file-upload-item ${u.status}`}>
            <span className="file-name">{u.name}</span>
            <span className="file-status">{u.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileUploadPanel;
