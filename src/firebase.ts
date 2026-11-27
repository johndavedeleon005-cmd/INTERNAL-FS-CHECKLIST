import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const PUBLIC_INSPECTOR_ID_KEY = 'iqaf005_public_inspector_id';

export function getOrCreatePublicInspectorId(): string {
  try {
    const existing = localStorage.getItem(PUBLIC_INSPECTOR_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,128}$/.test(existing)) {
      return existing;
    }
    const generated = `public-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    localStorage.setItem(PUBLIC_INSPECTOR_ID_KEY, generated);
    return generated;
  } catch {
    return 'public-inspector';
  }
}

const config = firebaseConfig as typeof firebaseConfig & {
  firestoreDatabaseId?: string;
};

const app = initializeApp(config);
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
        localCache: memoryLocalCache(),
      },
      config.firestoreDatabaseId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          experimentalAutoDetectLongPolling: true,
          ignoreUndefinedProperties: true,
        },
        config.firestoreDatabaseId
      );
    } catch {
      return config.firestoreDatabaseId
        ? getFirestore(app, config.firestoreDatabaseId)
        : getFirestore(app);
    }
  }
})();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
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
  errorCode?: string | null;
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

export interface ExtractedFirebaseError {
  code: string;
  rawMessage: string;
  operationType: string | null;
  path: string | null;
  friendlySummary: string;
  guidance: string;
  retryable: boolean;
}

function inferCodeFromMessage(message: string): string {
  // Match explicit Firebase Storage or SDK error codes like (storage/unauthorized) or storage/quota-exceeded
  const storageMatch = message.match(/\b(storage\/[a-z0-9-]+)\b/i);
  if (storageMatch) return storageMatch[1].toLowerCase();

  const authMatch = message.match(/\b(auth\/[a-z0-9-]+)\b/i);
  if (authMatch) return authMatch[1].toLowerCase();

  const parenCodeMatch = message.match(/\(([a-z0-9_/-]+)\)/i);
  if (parenCodeMatch) return parenCodeMatch[1].toLowerCase();

  const lower = message.toLowerCase();
  if (
    lower.includes('permission-denied') ||
    lower.includes('missing or insufficient permissions')
  ) {
    return 'permission-denied';
  }
  if (lower.includes('quota exceeded') || lower.includes('resource-exhausted')) {
    return 'resource-exhausted';
  }
  if (lower.includes('unauthenticated')) return 'unauthenticated';
  if (lower.includes('deadline-exceeded') || lower.includes('timed out')) {
    return 'deadline-exceeded';
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('client is offline') ||
    lower.includes('network') ||
    lower.includes('failed to fetch')
  ) {
    return 'unavailable';
  }
  if (lower.includes('failed-precondition')) return 'failed-precondition';
  if (lower.includes('already-exists')) return 'already-exists';
  if (lower.includes('invalid-argument') || lower.includes('exceeds the maximum')) {
    return 'invalid-argument';
  }
  if (lower.includes('aborted') || lower.includes('canceled')) {
    return 'canceled';
  }
  if (
    lower.includes('600 kb') ||
    lower.includes('920 kb') ||
    lower.includes('storage limits') ||
    lower.includes('hd storage limit')
  ) {
    return 'client/payload-too-large';
  }
  if (lower.includes('invalid or corrupted image')) {
    return 'client/invalid-image';
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'client/offline';
  }
  return 'unknown';
}

function describeFirebaseErrorCode(code: string): {
  friendlySummary: string;
  guidance: string;
  retryable: boolean;
} {
  switch (code) {
    case 'storage/unauthorized':
    case 'permission-denied':
      return {
        friendlySummary: 'Permission denied',
        guidance:
          'Verify you are signed in with Google and have Owner or Editor access to this inspection report in Cloud Firestore.',
        retryable: false,
      };
    case 'storage/unauthenticated':
    case 'unauthenticated':
      return {
        friendlySummary: 'Authentication required',
        guidance:
          'Your Firebase session expired or is missing. Sign out and sign in with Google again, then retry the photo upload.',
        retryable: false,
      };
    case 'storage/quota-exceeded':
    case 'resource-exhausted':
      return {
        friendlySummary: 'Cloud quota exceeded',
        guidance:
          'Daily Cloud Firestore write quota has been reached. Your photo remains safely cached locally and can be synced once quota resets.',
        retryable: false,
      };
    case 'storage/retry-limit-exceeded':
    case 'deadline-exceeded':
      return {
        friendlySummary: 'Upload timed out',
        guidance:
          'The upload exceeded the network retry/time limit. Check signal strength and tap Retry.',
        retryable: true,
      };
    case 'storage/canceled':
    case 'canceled':
    case 'aborted':
      return {
        friendlySummary: 'Upload canceled',
        guidance:
          'The upload request was interrupted or aborted before completion. Tap Retry to upload again.',
        retryable: true,
      };
    case 'storage/object-not-found':
    case 'not-found':
      return {
        friendlySummary: 'Target record not found',
        guidance:
          'The parent report or storage target was not found online. Tap Retry to re-create the parent report and upload the photo.',
        retryable: true,
      };
    case 'storage/invalid-checksum':
    case 'client/invalid-image':
      return {
        friendlySummary: 'Invalid image data',
        guidance:
          'The image data could not be validated or decoded. Re-capture or re-select the photo as JPG/PNG.',
        retryable: false,
      };
    case 'storage/bucket-not-found':
    case 'storage/project-not-found':
    case 'failed-precondition':
      return {
        friendlySummary: 'Firebase configuration issue',
        guidance:
          'The configured Cloud Firestore database rejected the precondition. Verify the Firebase project setup and deployed Firestore rules.',
        retryable: false,
      };
    case 'client/payload-too-large':
    case 'invalid-argument':
      return {
        friendlySummary: 'Photo payload rejected',
        guidance:
          'The photo exceeded the 920 KB HD document payload limit or contained an invalid field value. Try switching HD off or re-capturing.',
        retryable: false,
      };
    case 'unavailable':
    case 'client/offline':
      return {
        friendlySummary: 'Network unavailable',
        guidance:
          'Device is offline or Firebase servers could not be reached. The photo is stored locally and will sync when connectivity returns.',
        retryable: true,
      };
    default:
      return {
        friendlySummary: 'Upload failed',
        guidance:
          'An unexpected Firebase error occurred. Check the error code and attempt log below, then tap Retry.',
        retryable: true,
      };
  }
}

export function extractFirebaseErrorDetails(
  error: unknown
): ExtractedFirebaseError {
  let code: string | null = null;
  let rawMessage = error instanceof Error ? error.message : String(error);
  let operationType: string | null = null;
  let path: string | null = null;

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    code = (error as { code: string }).code.toLowerCase();
  }

  // Parse JSON payload emitted by handleFirestoreError
  if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawMessage) as Partial<FirestoreErrorInfo>;
      if (typeof parsed.error === 'string') {
        rawMessage = parsed.error;
      }
      if (!code && typeof parsed.errorCode === 'string' && parsed.errorCode) {
        code = parsed.errorCode.toLowerCase();
      }
      if (typeof parsed.operationType === 'string') {
        operationType = parsed.operationType;
      }
      if (typeof parsed.path === 'string') {
        path = parsed.path;
      }
    } catch {
      // Keep rawMessage as-is
    }
  }

  const resolvedCode = code || inferCodeFromMessage(rawMessage);
  const { friendlySummary, guidance, retryable } =
    describeFirebaseErrorCode(resolvedCode);

  return {
    code: resolvedCode,
    rawMessage,
    operationType,
    path,
    friendlySummary,
    guidance,
    retryable,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const rawCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    errorCode: rawCode,
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
