import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, FileCode, CheckCircle, Terminal, Layers } from 'lucide-react';

interface ChromeExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChromeExtensionModal: React.FC<ChromeExtensionModalProps> = ({ isOpen, onClose }) => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('manifest.json');
  const [copied, setCopied] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/extension/files')
        .then((res) => res.json())
        .then((data) => {
          if (data.files) setFiles(data.files);
        })
        .catch((err) => console.error('Failed to load extension files:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    if (files[selectedFile]) {
      navigator.clipboard.writeText(files[selectedFile]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-950 border border-sky-800 text-sky-400">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Chrome Extension (Manifest V3)</span>
                <span className="text-[10px] font-mono bg-sky-950 text-sky-300 border border-sky-800 px-2 py-0.5 rounded-full">
                  v1.0.0
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Integrates Maya with Chrome, Brave, and Edge for direct tab control &amp; web automation.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close extension modal"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick Setup Instructions */}
          <div className="rounded-2xl bg-slate-950 border border-slate-800 p-5 space-y-3">
            <h3 className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span>Easy 4-Step Installation in Chrome / Brave / Edge</span>
            </h3>

            <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                Open your browser and navigate to{' '}
                <code className="text-sky-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                  chrome://extensions
                </code>{' '}
                (or <code className="text-sky-300 bg-slate-900 px-1.5 py-0.5 rounded">brave://extensions</code>).
              </li>
              <li>
                Toggle <strong>Developer mode</strong> ON in the upper right-hand corner.
              </li>
              <li>
                Click <strong>"Load unpacked"</strong> in the top-left toolbar.
              </li>
              <li>
                Select the <code className="text-purple-300 bg-slate-900 px-1.5 py-0.5 rounded">chrome-extension</code>{' '}
                folder from this project workspace.
              </li>
            </ol>

            <div className="pt-2 flex items-center gap-2 text-xs text-emerald-400 font-medium">
              <CheckCircle className="w-4 h-4" />
              <span>Extension connects to http://localhost:3000 to execute tabs &amp; navigation automatically.</span>
            </div>
          </div>

          {/* Code Viewer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {Object.keys(files).map((fileName) => (
                  <button
                    key={fileName}
                    type="button"
                    onClick={() => setSelectedFile(fileName)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono transition-colors cursor-pointer ${
                      selectedFile === fileName
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>{fileName}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy File'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadFile(selectedFile, files[selectedFile] || '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download {selectedFile}</span>
                </button>
              </div>
            </div>

            {/* Code Box */}
            <div className="relative rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
              <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/40 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                <span>{selectedFile}</span>
                <span>Manifest V3 Ready</span>
              </div>
              <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-72 leading-relaxed whitespace-pre-wrap">
                {files[selectedFile] || 'Loading file content...'}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>Files are located in the <code>/chrome-extension</code> folder.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
