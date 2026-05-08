import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../config/firebase';
import { StorageService } from '../services/storage';
import { FirestoreService } from '../services/firestore';
import { Contact } from '../types';

interface AuthContextType {
  // Email entry step
  email: string | null;
  sendCode: (email: string, teamId?: string) => Promise<{ success: boolean; error?: string }>;

  // Code verification step
  verifyCode: (code: string, stayLoggedIn?: boolean) => Promise<{ success: boolean; error?: string }>;
  codeId: string | null;

  // Contact selection (if multiple contacts with same email)
  matchedContacts: Contact[] | null;
  teamSummaries: { id: string; name: string }[] | null;
  selectContact: (contactId: string, stayLoggedIn?: boolean) => Promise<{ success: boolean; error?: string }>;

  // Profile step
  contact: Contact | null;
  isLoading: boolean;
  isInitializing: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refreshContact: () => Promise<void>;
  showContactSelection: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [email, setEmail] = useState<string | null>(null);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [matchedContacts, setMatchedContacts] = useState<Contact[] | null>(null);
  const [teamSummaries, setTeamSummaries] = useState<{ id: string; name: string }[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const isLoggingOut = useRef(false);

  // Check for existing auth on mount and listen to changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Skip restoring session if a logout is in progress
      if (isLoggingOut.current) {
        setIsInitializing(false);
        return;
      }

      if (user) {
        // User is signed in, fetch contact if not already set
        if (!contact) {
          const savedContactId = await StorageService.getSelectedContactId();
          if (savedContactId && !isLoggingOut.current) {
            try {
              // Refresh session token if expired or expiring within 24 hours.
              // sessionExpires is a custom claim used by Firestore security rules —
              // it does NOT auto-renew like Firebase Auth ID tokens. Without this,
              // all isSelfContact() rule checks fail silently after 7 days.
              const sessionExpires = await StorageService.getSessionExpires();
              const oneDayMs = 24 * 60 * 60 * 1000;
              if (sessionExpires && sessionExpires - Date.now() < oneDayMs) {
                try {
                  const refreshed = await FirestoreService.switchContact(savedContactId);
                  if (refreshed?.customToken) {
                    await signInWithCustomToken(auth, refreshed.customToken);
                    await StorageService.saveSessionExpires(refreshed.sessionExpires);
                  }
                } catch {
                  // Non-critical — proceed with existing session
                }
              }

              const contactData = await FirestoreService.getContact(savedContactId);
              if (contactData && !isLoggingOut.current) {
                setContact(contactData);
              } else if (!contactData) {
                // If contact not found, sign out
                await logout();
              }
            } catch (error) {
              console.error('Error loading contact on auth change:', error);
            }
          }
        }
      } else {
        // User is signed out
        if (contact) {
          setContact(null);
        }
      }
      setIsInitializing(false);
    });

    // Initial check from Storage
    checkInitialStorage();

    return () => unsubscribe();
  }, [contact]);

  const checkInitialStorage = async () => {
    try {
      const [savedEmail, savedCodeId, stayLoggedIn] = await Promise.all([
        StorageService.getEmail(),
        StorageService.getCodeId(),
        StorageService.getStayLoggedIn(),
      ]);

      if (savedEmail) {
        setEmail(savedEmail);
      }

      if (savedCodeId) {
        setCodeId(savedCodeId);
      }

      // If stayLoggedIn was false, we sign out on fresh start
      if (!stayLoggedIn && auth.currentUser) {
        await logout();
      }
    } catch (error) {
      console.error('Error checking initial storage:', error);
    }
  };

  const sendCode = async (
    emailInput: string,
    teamId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);

      if (auth.currentUser) {
        await firebaseSignOut(auth).catch(() => undefined);
        setContact(null);
      }

      const result = await FirestoreService.sendVerificationCode(emailInput, teamId);

      await StorageService.saveEmail(emailInput);
      await StorageService.saveCodeId(result.codeId);

      setEmail(emailInput);
      setCodeId(result.codeId);
      setVerifiedCode(null);
      setMatchedContacts(null);
      setTeamSummaries(null);

      return { success: true };
    } catch (error: any) {
      console.error('Error sending code:', error);
      return {
        success: false,
        error: error.message || 'Failed to send verification code'
      };
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async (code: string, stayLoggedIn: boolean = true): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);

      if (!codeId) {
        return { success: false, error: 'No verification code ID found' };
      }

      const normalizedCode = code.trim();
      const result = await FirestoreService.verifyCode(codeId, normalizedCode);

      if (Object.prototype.hasOwnProperty.call(result, 'teamSummaries')) {
        setTeamSummaries(result.teamSummaries ?? null);
      }

      if (!result.verified) {
        return { success: false, error: 'Invalid code' };
      }

      // Save stayLoggedIn preference
      await StorageService.saveStayLoggedIn(stayLoggedIn);

      // If multiple contacts and user needs to select
      if (result.requiresContactSelection && result.matchedContacts) {
        setVerifiedCode(normalizedCode);
        setMatchedContacts(result.matchedContacts);
        return { success: true };
      }

      if (result.customToken && result.contact) {
        await signInWithCustomToken(auth, result.customToken);
        await StorageService.saveSelectedContactId(result.contact.id);
        if (result.sessionExpires) {
          await StorageService.saveSessionExpires(result.sessionExpires);
        }
        await StorageService.removeCodeId();

        setCodeId(null);
        setVerifiedCode(null);
        setMatchedContacts(null);
        setTeamSummaries(null);
        setContact(result.contact);

        return { success: true };
      }

      return { success: false, error: 'Could not load contact data' };
    } catch (error: any) {
      const extraInfo = `Code: ${error.code || 'N/A'}\nStack: ${error.stack || 'N/A'}`;
      console.error('Error verifying code:', error, extraInfo);
      return {
        success: false,
        error: (error.message || 'Failed to verify code') + '\n' + extraInfo
      };
    } finally {
      setIsLoading(false);
    }
  };

  const selectContact = async (contactId: string, stayLoggedIn: boolean = true): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('[AuthContext] selectContact called with:', contactId, 'stayLoggedIn:', stayLoggedIn);
      setIsLoading(true);

      // Save stayLoggedIn preference
      await StorageService.saveStayLoggedIn(stayLoggedIn);

      const hasVerificationContext = Boolean(codeId && verifiedCode);

      if (!hasVerificationContext) {
        const switchResult = await FirestoreService.switchContact(contactId);

        console.log('[AuthContext] switchContact result:', switchResult);

        if (switchResult && switchResult.customToken && switchResult.contact) {
          await signInWithCustomToken(auth, switchResult.customToken);
          await StorageService.saveSelectedContactId(contactId);
          if (switchResult.sessionExpires) {
            await StorageService.saveSessionExpires(switchResult.sessionExpires);
          }
          await StorageService.removeCodeId();

          setCodeId(null);
          setVerifiedCode(null);
          setMatchedContacts(null);
          setTeamSummaries(null);
          setContact(switchResult.contact);
          console.log('[AuthContext] Contact switched via existing session');
          return { success: true };
        } else {
          console.error('[AuthContext] Failed to switch contact via existing session', switchResult);
          return { success: false, error: 'Failed to switch contact. Please try logging in again.' };
        }
      }

      const result = await FirestoreService.verifyCode(codeId!, verifiedCode!, contactId);
      console.log('[AuthContext] verifyCode response for contact selection:', result);

      if (Object.prototype.hasOwnProperty.call(result, 'teamSummaries')) {
        setTeamSummaries(result.teamSummaries ?? null);
      }

      if (result.verified && result.customToken && result.contact) {
        await signInWithCustomToken(auth, result.customToken);
        await StorageService.saveSelectedContactId(contactId);
        if (result.sessionExpires) {
          await StorageService.saveSessionExpires(result.sessionExpires);
        }
        await StorageService.removeCodeId();

        setCodeId(null);
        setVerifiedCode(null);
        setMatchedContacts(null);
        setTeamSummaries(null);
        setContact(result.contact);
        console.log('[AuthContext] Contact state updated, isAuthenticated should now be true');
        return { success: true };
      } else {
        console.error('[AuthContext] Failed to finalize contact selection');
        return { success: false, error: 'Failed to authenticate. Please try again.' };
      }
    } catch (error: any) {
      const extraInfo = `Code: ${error.code || 'N/A'}\nStack: ${error.stack || 'N/A'}`;
      console.error('[AuthContext] Error selecting contact:', error, extraInfo);
      return {
        success: false,
        error: (error.message || 'An unexpected error occurred. Please try again.') + '\n' + extraInfo
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    isLoggingOut.current = true;
    await firebaseSignOut(auth).catch(() => undefined);
    await StorageService.clearAuth();
    setEmail(null);
    setCodeId(null);
    setVerifiedCode(null);
    setContact(null);
    setMatchedContacts(null);
    setTeamSummaries(null);
    // Reset flag after state updates are batched
    setTimeout(() => {
      isLoggingOut.current = false;
    }, 0);
  };

  const refreshContact = async () => {
    if (contact) {
      const updatedContact = await FirestoreService.getContact(contact.id);
      if (updatedContact) {
        setContact(updatedContact);
      }
    }
  };

  const showContactSelection = async () => {
    setIsLoading(true);
    try {
      if (!matchedContacts && email) {
        const contacts = await FirestoreService.getContactsByEmail(email);
        setMatchedContacts(contacts);
      }
    } catch (error) {
      console.error('Error showing contact selection:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        email,
        sendCode,
        verifyCode,
        codeId,
        matchedContacts,
        teamSummaries,
        selectContact,
        contact,
        isLoading,
        isInitializing,
        isAuthenticated: !!contact,
        logout,
        refreshContact,
        showContactSelection
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
