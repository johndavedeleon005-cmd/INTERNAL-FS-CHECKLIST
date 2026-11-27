import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, Delete, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { FORM_DOCUMENTATION_NO, FORM_REVISION_NO } from '../data/checklistData';
import { JiangNanLogo } from './JiangNanLogo';

const REQUIRED_PIN = '1010';
const PIN_LENGTH = 4;

interface PinCodeGateScreenProps {
  onUnlock: () => void;
}

export function PinCodeGateScreen({ onUnlock }: PinCodeGateScreenProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const verifyPin = (candidateDigits: string[]) => {
    const joined = candidateDigits.join('');
    if (joined.length < PIN_LENGTH) {
      setErrorMessage('Please enter all 4 digits for JN - _ _ _ _.');
      return;
    }
    if (joined === REQUIRED_PIN) {
      setErrorMessage(null);
      onUnlock();
    } else {
      setErrorMessage('Invalid access PIN. Please check your 4-digit code and try again.');
      setDigits(['', '', '', '']);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 20);
    }
  };

  const handleDigitChange = (index: number, rawValue: string) => {
    const numeric = rawValue.replace(/\D/g, '');
    if (!numeric) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      setErrorMessage(null);
      return;
    }

    const char = numeric.slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setErrorMessage(null);

    if (index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d.length === 1)) {
      verifyPin(next);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
        setErrorMessage(null);
      } else if (index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        setErrorMessage(null);
        inputRefs.current[index - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!pasted) return;
    const next = ['', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setDigits(next);
    setErrorMessage(null);

    if (pasted.length === PIN_LENGTH) {
      verifyPin(next);
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
  };

  const handleKeypadPress = (digit: string) => {
    const emptyIdx = digits.findIndex((d) => d === '');
    const targetIdx = emptyIdx === -1 ? PIN_LENGTH - 1 : emptyIdx;
    const next = [...digits];
    next[targetIdx] = digit;
    setDigits(next);
    setErrorMessage(null);

    if (targetIdx < PIN_LENGTH - 1) {
      inputRefs.current[targetIdx + 1]?.focus();
    } else {
      inputRefs.current[targetIdx]?.focus();
    }

    if (next.every((d) => d.length === 1)) {
      verifyPin(next);
    }
  };

  const handleKeypadBackspace = () => {
    let removeIdx = -1;
    for (let i = PIN_LENGTH - 1; i >= 0; i--) {
      if (digits[i] !== '') {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) return;
    const next = [...digits];
    next[removeIdx] = '';
    setDigits(next);
    setErrorMessage(null);
    inputRefs.current[removeIdx]?.focus();
  };

  const handleClearAll = () => {
    setDigits(['', '', '', '']);
    setErrorMessage(null);
    inputRefs.current[0]?.focus();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    verifyPin(digits);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between px-4 py-8">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[440px] bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Top Brand Header */}
          <div className="px-6 pt-7 pb-5 border-b border-slate-200">
            <div className="flex items-center justify-between gap-3 mb-5">
              <JiangNanLogo />
              <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums">
                {FORM_DOCUMENTATION_NO} · Rev. {FORM_REVISION_NO}
              </span>
            </div>

            <div className="text-[11px] font-semibold text-red-700">
              Quality Assurance Department
            </div>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight mt-1">
              Store Inspection Access Gate
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed mt-1.5">
              Enter the 4-digit security PIN code (<span className="font-mono font-semibold text-slate-800">JN - _ _ _ _</span>) to access the IQAF-005 Store Inspection Checklist.
            </p>
          </div>

          {/* PIN Entry Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label
                htmlFor="pin-digit-0"
                className="block text-xs font-semibold text-slate-700 mb-2.5"
              >
                Access PIN Code
              </label>

              <div className="flex items-center justify-center gap-2 sm:gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex items-center gap-1.5 pr-1 select-none">
                  <span className="font-mono text-lg sm:text-xl font-bold tracking-tight text-red-700">
                    JN
                  </span>
                  <span className="font-mono text-lg sm:text-xl font-bold text-slate-400">
                    -
                  </span>
                </div>

                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`pin-digit-${idx}`}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    autoComplete="one-time-code"
                    value={digit}
                    placeholder="_"
                    aria-label={`PIN digit ${idx + 1} of 4`}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    onPaste={handlePaste}
                    className={`w-11 h-12 sm:w-12 sm:h-13 text-center font-mono text-lg sm:text-xl font-bold tabular-nums rounded-lg border bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-700/20 ${
                      digit
                        ? 'border-slate-900 text-slate-950'
                        : 'border-slate-300 text-slate-400'
                    }`}
                  />
                ))}
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="border border-red-200 bg-red-50 rounded-lg p-3 text-xs text-red-900 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div className="leading-relaxed">{errorMessage}</div>
              </div>
            )}

            {/* Quick Numeric Pad for Touch & Desktop */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeypadPress(num)}
                  className="h-11 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 font-mono text-base font-semibold text-slate-900 tabular-nums transition-colors cursor-pointer"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClearAll}
                className="h-11 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xs font-semibold text-slate-600 transition-colors cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress('0')}
                className="h-11 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 font-mono text-base font-semibold text-slate-900 tabular-nums transition-colors cursor-pointer"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleKeypadBackspace}
                aria-label="Delete last digit"
                className="h-11 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 inline-flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
              >
                <Delete className="w-4 h-4" />
              </button>
            </div>

            <button
              type="submit"
              className="w-full h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 active:bg-red-900 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="w-4 h-4" />
              <span>Unlock Inspection Site</span>
            </button>

            <div className="pt-2 border-t border-slate-100 flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
              <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span>
                Protected by Jiang Nan QA PIN verification (<span className="font-mono font-medium text-slate-700">JN - _ _ _ _</span>).
              </span>
            </div>
          </form>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-400 pt-6 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
        <span>IQAF-005 Store Inspection System · Quality Assurance Portal</span>
      </footer>
    </div>
  );
}
