import { AlertCircle, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { FORM_DOCUMENTATION_NO, FORM_REVISION_NO } from '../data/checklistData';
import { JiangNanLogo } from './JiangNanLogo';

interface AuthGateScreenProps {
  mode: 'loading' | 'signin';
  isSigningIn: boolean;
  errorMessage: string | null;
  hasPendingShareLink: boolean;
  onSignIn: () => Promise<void>;
}

function GoogleMarkIcon() {
  return (
    <svg
      className="w-4 h-4 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3a7.17 7.17 0 0 1-10.68-3.77H1.39v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.38 14.33a7.2 7.2 0 0 1 0-4.66V6.58H1.39a12 12 0 0 0 0 10.84l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.39 6.58l3.99 3.09A7.17 7.17 0 0 1 12 4.75Z"
      />
    </svg>
  );
}

export function AuthGateScreen({
  mode,
  isSigningIn,
  errorMessage,
  hasPendingShareLink,
  onSignIn,
}: AuthGateScreenProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between px-4 py-10">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[440px] bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Top Brand Strip */}
          <div className="px-6 pt-7 pb-5 border-b border-slate-200">
            <div className="flex items-center justify-between gap-3 mb-5">
              <JiangNanLogo />
              <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums">
                {FORM_DOCUMENTATION_NO} · Rev. {FORM_REVISION_NO}
              </span>
            </div>

            <div className="text-[11px] font-semibold uppercase tracking-wider text-red-700">
              Quality Assurance Department
            </div>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight mt-1">
              Store Inspection Checklist
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed mt-1.5">
              Sign in with an authorized Google account to access branch
              compliance rankings, store audit checklists, photo proofs, and
              signed IQAF-005 reports.
            </p>
          </div>

          {/* Action Body */}
          <div className="p-6 space-y-4">
            {mode === 'loading' ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2.5 text-center">
                <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
                <div className="text-sm font-medium text-slate-800">
                  Verifying Google session…
                </div>
                <p className="text-xs text-slate-500">
                  Checking authentication status before loading inspection data.
                </p>
              </div>
            ) : (
              <>
                {hasPendingShareLink && (
                  <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 text-xs text-slate-700 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-slate-900">
                        Shared report link detected
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        Sign in with Google to open the shared IQAF-005
                        inspection report automatically.
                      </p>
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div
                    role="alert"
                    className="border border-red-200 bg-red-50 rounded-lg p-3 text-xs text-red-900 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">{errorMessage}</div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void onSignIn()}
                  disabled={isSigningIn}
                  className="w-full h-11 px-4 inline-flex items-center justify-center gap-2.5 text-sm font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  {isSigningIn ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                  ) : (
                    <GoogleMarkIcon />
                  )}
                  <span>
                    {isSigningIn
                      ? 'Signing in with Google…'
                      : 'Sign in with Google'}
                  </span>
                </button>

                <div className="pt-2 border-t border-slate-100 flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    Verified Google sign-in is required to protect branch audit
                    records, photo attachments, and electronic sign-offs.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-400 pt-6">
        IQAF-005 Store Inspection System · Online Firestore Sync
      </footer>
    </div>
  );
}
