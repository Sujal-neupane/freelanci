import { useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';

// Match backend idle timeout (30 minutes)
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function useIdleTimeout() {
  const { user, logout } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleIdleTimeout = useCallback(() => {
    if (user) {
      console.warn('Session expired due to inactivity');
      logout(); // This will clear state and redirect to login
    }
  }, [user, logout]);

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Only track idle time if user is logged in
    if (user) {
      timeoutRef.current = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    }
  }, [user, handleIdleTimeout]);

  useEffect(() => {
    if (!user) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    // Events that indicate user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    // Set up initial timer
    resetTimer();

    // Attach listeners
    events.forEach(event => {
      document.addEventListener(event, resetTimer, { passive: true });
    });

    // Cleanup
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach(event => {
        document.removeEventListener(event, resetTimer);
      });
    };
  }, [user, resetTimer]);
}
