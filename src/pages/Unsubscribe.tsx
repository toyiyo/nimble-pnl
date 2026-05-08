import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { supabase } from '@/integrations/supabase/client';

type Status = 'pending' | 'success' | 'error' | 'invalid';

const VALID_LISTS = new Set(['trial_lifecycle', 'marketing', 'all']);

function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const list = params.get('list') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    setErrorMsg('');
    if (!token || !list || !VALID_LISTS.has(list)) {
      setStatus('invalid');
      return;
    }
    setStatus('pending');

    let cancelled = false;
    const run = async () => {
      try {
        const { error } = await supabase.functions.invoke('unsubscribe-email', {
          body: { token, list },
        });
        if (cancelled) return;
        if (error) {
          setStatus('error');
          setErrorMsg(error.message || 'Something went wrong');
          return;
        }
        setStatus('success');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Something went wrong');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, list]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <AppLogo />
        </div>
        <div
          aria-live="polite"
          aria-atomic="true"
          className="rounded-xl border border-border/40 bg-background p-8"
        >
          {status === 'pending' && <PendingView />}
          {status === 'success' && <SuccessView list={list} />}
          {status === 'invalid' && <InvalidView />}
          {status === 'error' && <ErrorView message={errorMsg} />}
        </div>
      </div>
    </div>
  );
}

function PendingView() {
  return (
    <div role="status" className="flex flex-col items-center text-center gap-3 py-4">
      <Loader2
        aria-label="Unsubscribing"
        className="h-8 w-8 text-muted-foreground animate-spin"
      />
      <p className="text-[14px] text-muted-foreground">Unsubscribing you…</p>
    </div>
  );
}

function SuccessView({ list }: { list: string }) {
  const label = list === 'all' ? 'all email' : `${list.replace('_', ' ')} email`;
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
      <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <CheckCircle2 className="h-6 w-6 text-foreground" aria-hidden />
      </div>
      <div>
        <h1 className="text-[17px] font-semibold text-foreground">You're unsubscribed</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          We won't send you any more {label} from EasyShiftHQ.
        </p>
      </div>
      <p className="text-[13px] text-muted-foreground mt-2">
        Changed your mind? Reply to any of our emails and we'll add you back.
      </p>
    </div>
  );
}

function InvalidView() {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
      <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-foreground" aria-hidden />
      </div>
      <div>
        <h1 className="text-[17px] font-semibold text-foreground">
          Invalid unsubscribe link
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          The link is missing required parameters or has been malformed by an
          email client. Try clicking the link again from the original email, or
          reply to that email and we'll unsubscribe you manually.
        </p>
      </div>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
      <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-foreground" aria-hidden />
      </div>
      <div>
        <h1 className="text-[17px] font-semibold text-foreground">Something went wrong</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          {message || 'We could not complete the unsubscribe just now.'} Please
          reply to one of our emails and we'll unsubscribe you manually.
        </p>
      </div>
    </div>
  );
}

export default Unsubscribe;
