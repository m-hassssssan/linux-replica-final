import { useState, useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';

interface Tab {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIdx: number;
}

const DEFAULT_LINKS = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org', color: '#e74c3c', letter: 'W' },
  { name: 'Reddit', url: 'https://www.reddit.com', color: '#ff4500', letter: 'R' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', color: '#ff6600', letter: 'H' },
  { name: 'GitHub', url: 'https://github.com', color: '#24292e', letter: 'G' },
  { name: 'Vite', url: 'https://vite.dev', color: '#646cff', letter: 'V' },
  { name: 'React', url: 'https://react.dev', color: '#149eca', letter: 'R' },
];

export default function Browser() {
  // Tabs State
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 'default',
      title: 'Home',
      url: 'strata://home',
      history: ['strata://home'],
      historyIdx: 0,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('default');

  // Bookmarks State
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    const saved = localStorage.getItem('strata_browser_bookmarks');
    return saved ? JSON.parse(saved) : [
      'https://en.wikipedia.org',
      'https://github.com',
      'https://news.ycombinator.com'
    ];
  });

  // Global Settings
  const [proxyMode, setProxyMode] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState<string>('');

  // Navigation input state (reflects active tab's URL)
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const [inputUrl, setInputUrl] = useState(activeTab.url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync address input when active tab changes
  useEffect(() => {
    setInputUrl(activeTab.url);
    setError(null);
    setSrcDoc('');
    
    if (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://')) {
      loadExternalUrl(activeTab.url);
    }
  }, [activeTabId, activeTab.url]);

  // Persist bookmarks
  useEffect(() => {
    localStorage.setItem('strata_browser_bookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);

  // Listen for navigation requests inside the iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'BROWSER_NAVIGATE') {
        navigate(e.data.url);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeTabId, tabs]);

  const injectProxyScript = (html: string, baseUrl: string) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Inject base tag if not present to correctly resolve relative styles/images
      let baseTag = doc.querySelector('base');
      if (!baseTag) {
        baseTag = doc.createElement('base');
        if (doc.head) {
          doc.head.insertBefore(baseTag, doc.head.firstChild);
        } else {
          const head = doc.createElement('head');
          doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
          head.appendChild(baseTag);
        }
      }
      baseTag.setAttribute('href', baseUrl);
      baseTag.setAttribute('target', '_self');

      // Add a client-side routing interceptor for forms and anchors
      const script = doc.createElement('script');
      script.textContent = `
        (function() {
          // Click Interception
          document.addEventListener('click', function(e) {
            const anchor = e.target.closest('a');
            if (anchor) {
              const href = anchor.getAttribute('href');
              if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                e.preventDefault();
                try {
                  const absoluteUrl = new URL(href, document.baseURI).href;
                  window.parent.postMessage({ type: 'BROWSER_NAVIGATE', url: absoluteUrl }, '*');
                } catch(err) {
                  console.error(err);
                }
              }
            }
          }, true);

          // GET Form Submission Interception
          document.addEventListener('submit', function(e) {
            const form = e.target;
            const action = form.getAttribute('action') || '';
            const method = (form.getAttribute('method') || 'get').toLowerCase();
            
            if (method === 'get') {
              e.preventDefault();
              const formData = new FormData(form);
              const params = new URLSearchParams();
              for (const [key, value] of formData.entries()) {
                params.append(key, value.toString());
              }
              try {
                const absoluteAction = new URL(action, document.baseURI).href;
                const targetUrl = absoluteAction + (absoluteAction.includes('?') ? '&' : '?') + params.toString();
                window.parent.postMessage({ type: 'BROWSER_NAVIGATE', url: targetUrl }, '*');
              } catch(err) {
                console.error(err);
              }
            }
          }, true);
        })();
      `;
      doc.body.appendChild(script);

      return doc.documentElement.outerHTML;
    } catch (err) {
      console.error('Failed to parse & inject proxy scripts:', err);
      return html;
    }
  };

  const loadExternalUrl = async (targetUrl: string) => {
    // If it's Google Search (with igu parameter), load directly in direct iframe mode
    const isGoogle = targetUrl.includes('google.com/search') || targetUrl === 'https://www.google.com' || targetUrl === 'https://google.com';
    
    if (isGoogle || !proxyMode) {
      setSrcDoc('');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const proxiedUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(proxiedUrl);
      if (!res.ok) throw new Error('Failed to fetch from proxy server');
      
      const data = await res.json();
      if (!data.contents) throw new Error('Empty response from proxy');

      const processedHtml = injectProxyScript(data.contents, targetUrl);
      setSrcDoc(processedHtml);
      
      // Update tab title based on URL name
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          try {
            const parsed = new URL(targetUrl);
            return { ...t, title: parsed.hostname.replace('www.', '') };
          } catch {
            return { ...t, title: 'Web Page' };
          }
        }
        return t;
      }));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Page failed to load via proxy.');
      setSrcDoc('');
    } finally {
      setIsLoading(false);
    }
  };

  const navigate = (target: string) => {
    let finalUrl = target;
    if (target !== 'strata://home' && !target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.includes('.')) {
        finalUrl = 'https://' + target;
      } else {
        // Use direct Google search (igu=1 is handled dynamically in directIframeUrl)
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
    }

    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const nextHistory = [...t.history.slice(0, t.historyIdx + 1), finalUrl];
        return {
          ...t,
          url: finalUrl,
          history: nextHistory,
          historyIdx: nextHistory.length - 1,
          title: finalUrl === 'strata://home' ? 'Home' : 'Loading...'
        };
      }
      return t;
    }));
  };

  const handleGoBack = () => {
    if (activeTab.historyIdx > 0) {
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          const nextIdx = t.historyIdx - 1;
          return {
            ...t,
            historyIdx: nextIdx,
            url: t.history[nextIdx],
            title: t.history[nextIdx] === 'strata://home' ? 'Home' : 'Loading...'
          };
        }
        return t;
      }));
    }
  };

  const handleGoForward = () => {
    if (activeTab.historyIdx < activeTab.history.length - 1) {
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          const nextIdx = t.historyIdx + 1;
          return {
            ...t,
            historyIdx: nextIdx,
            url: t.history[nextIdx],
            title: t.history[nextIdx] === 'strata://home' ? 'Home' : 'Loading...'
          };
        }
        return t;
      }));
    }
  };

  const handleRefresh = () => {
    if (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://')) {
      loadExternalUrl(activeTab.url);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim()) {
      navigate(inputUrl.trim());
    }
  };

  // Tab Controls
  const handleNewTab = () => {
    const newId = 'tab_' + Date.now();
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title: 'Home',
        url: 'strata://home',
        history: ['strata://home'],
        historyIdx: 0,
      }
    ]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return; // Prevent closing the last tab

    const index = tabs.findIndex(t => t.id === tabId);
    const nextTabs = tabs.filter(t => t.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      const nextActiveIndex = Math.max(0, index - 1);
      setActiveTabId(nextTabs[nextActiveIndex].id);
    }
  };

  // Bookmark Toggle
  const toggleBookmark = () => {
    if (activeTab.url === 'strata://home') return;
    if (bookmarks.includes(activeTab.url)) {
      setBookmarks(prev => prev.filter(b => b !== activeTab.url));
    } else {
      setBookmarks(prev => [...prev, activeTab.url]);
    }
  };

  const isBookmarked = bookmarks.includes(activeTab.url);

  // Setup direct loading target URL (using Google igu parameter if applicable)
  let directIframeUrl = activeTab.url;
  if (activeTab.url.includes('google.com/search') && !activeTab.url.includes('igu=1')) {
    directIframeUrl = activeTab.url + '&igu=1';
  } else if ((activeTab.url === 'https://www.google.com' || activeTab.url === 'https://google.com') && !activeTab.url.includes('igu=1')) {
    directIframeUrl = 'https://www.google.com/search?igu=1';
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0b0f] font-sans">
      {/* 🚀 Dynamic Glassmorphic Tabs Bar */}
      <div className="h-10 flex items-end bg-[#13131a] px-3 gap-1 border-b border-white/5 select-none overflow-x-auto overflow-y-hidden scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group flex items-center h-8 min-w-[120px] max-w-[180px] px-3 py-1 rounded-t-lg text-xs font-medium cursor-pointer transition-all duration-200 ${
                isActive 
                  ? 'bg-[#1a1a26] text-white border-t border-x border-white/10' 
                  : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
              }`}
            >
              <Icons.Globe className={`w-3.5 h-3.5 mr-2 shrink-0 ${isActive ? 'text-cyan-400' : 'text-white/30'}`} />
              <span className="truncate flex-1 pr-1">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="p-0.5 rounded-full text-white/30 hover:bg-white/10 hover:text-white/80 shrink-0"
                >
                  <Icons.X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={handleNewTab}
          className="p-1 mb-1 rounded hover:bg-white/10 transition-colors text-white/50 hover:text-white/85"
        >
          <Icons.Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 🛠️ Modern Navigation Toolbar */}
      <div className="h-12 flex items-center px-4 gap-2 border-b border-white/5 bg-[#1a1a26]/80 backdrop-blur-md">
        <div className="flex items-center gap-1.5 shrink-0">
          <button 
            onClick={handleGoBack} 
            disabled={activeTab.historyIdx <= 0}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-all"
          >
            <Icons.ArrowLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={handleGoForward} 
            disabled={activeTab.historyIdx >= activeTab.history.length - 1}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-all"
          >
            <Icons.ArrowRight className="w-4 h-4" />
          </button>
          <button 
            onClick={handleRefresh} 
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          <button 
            onClick={() => navigate('strata://home')} 
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            <Icons.Home className="w-4 h-4" />
          </button>
          <button 
            onClick={() => window.open(activeTab.url, '_blank')} 
            disabled={activeTab.url === 'strata://home'}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-all"
            title="Open in new browser tab"
          >
            <Icons.ExternalLink className="w-4 h-4" />
          </button>
        </div>

        {/* Address Input Bar */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-2xl mx-2">
          <div className="flex items-center h-8 px-3 rounded-full bg-white/5 border border-white/10 hover:border-white/20 focus-within:border-cyan-400/50 transition-colors">
            {activeTab.url.startsWith('https://') ? (
              <Icons.Lock className="w-3.5 h-3.5 text-emerald-400 mr-2 shrink-0" />
            ) : (
              <Icons.Globe className="w-3.5 h-3.5 text-white/40 mr-2 shrink-0" />
            )}
            <input
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
              placeholder="Search Google directly..."
            />
            {activeTab.url !== 'strata://home' && (
              <button
                type="button"
                onClick={toggleBookmark}
                className="p-0.5 rounded text-white/40 hover:text-yellow-400 transition-colors"
              >
                <Icons.Star className={`w-4 h-4 ${isBookmarked ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              </button>
            )}
          </div>
        </form>

        {/* Proxy Toggle Controls */}
        <div className="flex items-center gap-3 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
              Proxy Mode
            </span>
            <button
              onClick={() => {
                const nextMode = !proxyMode;
                setProxyMode(nextMode);
                if (activeTab.url.startsWith('http')) {
                  // Reload URL using new settings
                  if (nextMode) {
                    loadExternalUrl(activeTab.url);
                  } else {
                    setSrcDoc('');
                  }
                }
              }}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-300 focus:outline-none ${
                proxyMode ? 'bg-cyan-500' : 'bg-white/15'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white shadow-md transform duration-300 ${
                  proxyMode ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ⭐ Bookmarks Toolbar */}
      {bookmarks.length > 0 && (
        <div className="h-8 flex items-center px-4 gap-2 bg-[#101016] border-b border-white/5 select-none overflow-x-auto scrollbar-none">
          <Icons.Star className="w-3 h-3 text-yellow-400 shrink-0" />
          {bookmarks.map((bm, idx) => {
            let label = bm;
            try {
              label = new URL(bm).hostname.replace('www.', '');
            } catch {
              label = bm.substring(0, 15);
            }
            return (
              <button
                key={idx}
                onClick={() => navigate(bm)}
                className="flex items-center h-6 px-2.5 rounded text-[11px] text-white/60 hover:text-white hover:bg-white/5 transition-all max-w-[120px] truncate shrink-0"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* 🔄 Dynamic Web Loading Progress Bar */}
      {isLoading && (
        <div className="h-0.5 w-full bg-cyan-950 overflow-hidden relative shrink-0">
          <div className="h-full bg-cyan-400 w-1/3 animate-pulse absolute left-0 right-0" style={{
            animation: 'loader-animation 1.5s infinite ease-in-out'
          }} />
        </div>
      )}

      {/* 🖥️ Main Viewport Area */}
      <div className="flex-1 overflow-hidden relative bg-[#13131c]">
        {activeTab.url === 'strata://home' ? (
          /* Custom Home Dashboard */
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none overflow-y-auto">
            <div className="mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-cyan-500/10">
                <Icons.Globe className="w-8 h-8 text-[#0a0a0f]" />
              </div>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-emerald-300 -webkit-background-clip: text -webkit-text-fill-color: transparent mb-2">
              Strata Web Explorer
            </h1>
            <p className="text-xs text-white/40 max-w-sm mb-8 leading-relaxed">
              Explore the real web. Search using Google or click below to launch preset pages bypassed automatically with CORS proxy technology.
            </p>

            <form onSubmit={handleSearchSubmit} className="w-full max-w-lg mb-8">
              <div className="flex items-center gap-2 p-1.5 rounded-xl bg-white/5 border border-white/10 focus-within:border-cyan-400/50 shadow-inner">
                <input
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  className="flex-1 bg-transparent px-3 text-sm text-white outline-none"
                  placeholder="Enter custom URL or search Google..."
                />
                <button type="submit" className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-400 text-[#0a0a0f] font-semibold text-xs hover:opacity-90 active:scale-95 transition-all">
                  Search
                </button>
              </div>
            </form>

            <div className="w-full max-w-lg">
              <div className="text-[10px] uppercase tracking-wider font-bold text-white/30 text-left mb-3">
                Speed Dial Presets
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {DEFAULT_LINKS.map((link) => (
                  <button
                     key={link.name}
                     onClick={() => navigate(link.url)}
                     className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 transition-all group"
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white mb-2 shadow group-hover:scale-105 transition-transform"
                      style={{ backgroundColor: link.color }}
                    >
                      {link.letter}
                    </div>
                    <span className="text-[10px] font-medium text-white/60 group-hover:text-white truncate max-w-full">
                      {link.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : error ? (
          /* Custom Proxy Connection Error Intercept */
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-[#13131c]">
            <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mb-4">
              <Icons.AlertTriangle className="w-7 h-7 text-rose-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">
              Failed to connect via Proxy
            </h2>
            <p className="text-xs text-white/50 max-w-sm mb-6 leading-relaxed">
              We couldn't download this site via proxy server. This website might block proxy fetches or be offline.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                onClick={() => window.open(activeTab.url, '_blank')}
                className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-xs text-[#0a0a0f] font-semibold active:scale-95 transition-all flex items-center gap-1.5 animate-pulse"
              >
                <Icons.ExternalLink className="w-3.5 h-3.5" />
                Open in New Tab
              </button>
              <button
                onClick={() => {
                  setProxyMode(false);
                  setSrcDoc('');
                  setError(null);
                }}
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/5 hover:bg-white/15 text-xs text-white font-medium active:scale-95 transition-all"
              >
                Disable Proxy & Try Direct Frame
              </button>
              <button
                onClick={() => navigate('https://www.google.com/search?q=' + encodeURIComponent(activeTab.url))}
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/5 hover:bg-white/15 text-xs text-white font-medium active:scale-95 transition-all animate-none"
              >
                Search on Google
              </button>
            </div>
          </div>
        ) : srcDoc ? (
          /* Render Proxied HTML via srcDoc */
          <iframe
            key={activeTab.id + '_' + activeTab.historyIdx}
            srcDoc={srcDoc}
            className="w-full h-full bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          /* Render Direct Iframe Fallback (e.g. for Google or custom framed sites) */
          <iframe
            key={activeTab.id + '_' + activeTab.historyIdx}
            src={directIframeUrl}
            className="w-full h-full bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>

      <style>{`
        @keyframes loader-animation {
          0% { left: -30%; width: 30%; }
          50% { width: 50%; }
          100% { left: 100%; width: 30%; }
        }
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-none {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
