import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const config = firebaseConfig as typeof firebaseConfig & {
  firestoreDatabaseId?: string;
};

const app = initializeApp(config);
export const db = config.firestoreDatabaseId
  ? getFirestore(app, config.firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope(GMAIL_SEND_SCOPE);
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Keep Gmail OAuth access token strictly in memory (never in localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGmailAccountEmail: string | null = null;

onAuthStateChanged(auth, (currentUser) => {
  if (!currentUser) {
    cachedGmailAccessToken = null;
    cachedGmailAccountEmail = null;
  }
});

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function getGmailAccountEmail(): string | null {
  return cachedGmailAccountEmail || auth.currentUser?.email || null;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedGmailAccessToken = credential.accessToken;
    cachedGmailAccountEmail = result.user.email ?? null;
  }
  return result;
}

export async function connectGmailForSending(forceAccountSelect = false): Promise<{
  accessToken: string;
  email: string | null;
}> {
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SEND_SCOPE);
  const params: Record<string, string> = {
    prompt: forceAccountSelect ? 'select_account consent' : 'consent',
  };
  if (!forceAccountSelect && auth.currentUser?.email) {
    params.login_hint = auth.currentUser.email;
  }
  provider.setCustomParameters(params);

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error(
      'Google did not return a Gmail access token. Please allow Gmail send permission and try again.'
    );
  }
  cachedGmailAccessToken = credential.accessToken;
  cachedGmailAccountEmail = result.user.email ?? null;
  return {
    accessToken: credential.accessToken,
    email: cachedGmailAccountEmail,
  };
}

export async function signOutUser() {
  cachedGmailAccessToken = null;
  cachedGmailAccountEmail = null;
  return signOut(auth);
}

// Validate Firestore connectivity on app startup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
