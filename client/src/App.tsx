import { useState, useEffect, useRef, useCallback } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Scenarios from './components/Scenarios';
import Products from './components/Products';
import Settings from './components/Settings';
import Migration from './components/Migration';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import { BarChart3, Package, FileText, Settings as SettingsIcon, LogOut, ArrowRightLeft, PanelLeftClose, PanelLeft } from 'lucide-react';

type Page = 'dashboard' | 'scenarios' | 'products' | 'settings' | 'migration';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setUserEmail('');
    setCurrentPage('dashboard');
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      toast.info('Session expired due to inactivity');
      handleLogout();
    }, INACTIVITY_TIMEOUT);
  }, [handleLogout]);

  // Set up activity listeners when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

    const handleActivity = () => {
      resetInactivityTimer();
    };

    // Start the timer
    resetInactivityTimer();

    // Add event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [isAuthenticated, resetInactivityTimer]);

  const handleLogin = (email: string, _password: string) => {
    setUserEmail(email);
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar Navigation */}
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-56'} bg-neutral-900 text-white flex flex-col transition-all duration-300`}>
        <div className={`${sidebarCollapsed ? 'px-2' : 'px-4'} py-5 border-b border-neutral-700 flex items-center justify-between`}>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-lg font-bold">AVO_NEXT</h1>
              <p className="text-xs text-neutral-400">Voice Ordering Test</p>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-2 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors ${sidebarCollapsed ? 'mx-auto' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex-1 ${sidebarCollapsed ? 'p-2' : 'p-3'} space-y-1`}>
          <button
            onClick={() => setCurrentPage('dashboard')}
            title={sidebarCollapsed ? 'Dashboard' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm transition-colors ${
              currentPage === 'dashboard'
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white border border-indigo-500/30'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Dashboard'}
          </button>
          <button
            onClick={() => setCurrentPage('scenarios')}
            title={sidebarCollapsed ? 'Scenarios' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm transition-colors ${
              currentPage === 'scenarios'
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white border border-indigo-500/30'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Scenarios'}
          </button>
          <button
            onClick={() => setCurrentPage('products')}
            title={sidebarCollapsed ? 'Products' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm transition-colors ${
              currentPage === 'products'
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white border border-indigo-500/30'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <Package className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Products'}
          </button>
          <button
            onClick={() => setCurrentPage('settings')}
            title={sidebarCollapsed ? 'Settings' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm transition-colors ${
              currentPage === 'settings'
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white border border-indigo-500/30'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <SettingsIcon className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Settings'}
          </button>
          <button
            onClick={() => setCurrentPage('migration')}
            title={sidebarCollapsed ? 'Migration' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm transition-colors ${
              currentPage === 'migration'
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white border border-indigo-500/30'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <ArrowRightLeft className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Migration'}
          </button>
        </nav>

        {/* User info and logout */}
        <div className={`${sidebarCollapsed ? 'p-2' : 'p-3'} border-t border-neutral-700`}>
          {!sidebarCollapsed && (
            <div className="px-3 py-2 mb-2">
              <p className="text-xs text-neutral-500 truncate">{userEmail}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Sign out' : undefined}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm text-neutral-400 hover:bg-red-500/10 hover:text-red-400 transition-colors`}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && 'Sign out'}
          </button>
        </div>
      </div>

      {/* Main Content - Keep pages mounted but hidden to preserve state */}
      <div className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 ${currentPage === 'dashboard' ? '' : 'hidden'}`}>
          <Dashboard />
        </div>
        <div className={`absolute inset-0 ${currentPage === 'scenarios' ? '' : 'hidden'}`}>
          <Scenarios />
        </div>
        <div className={`absolute inset-0 ${currentPage === 'products' ? '' : 'hidden'}`}>
          <Products />
        </div>
        <div className={`absolute inset-0 ${currentPage === 'settings' ? '' : 'hidden'}`}>
          <Settings />
        </div>
        <div className={`absolute inset-0 ${currentPage === 'migration' ? '' : 'hidden'}`}>
          <Migration />
        </div>
      </div>

      {/* Toast Notifications */}
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

export default App;
