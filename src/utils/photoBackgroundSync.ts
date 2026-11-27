import type { PhotoProof } from '../types/inspection';

export type BackgroundSyncTrigger =
  | 'online'
  | 'visibility'
  | 'signin'
  | 'manual'
  | 'scheduled';

export interface BackgroundSyncPhotoItem {
  reportId: string;
  itemNumber: number;
  photo: PhotoProof;
}

export interface BackgroundSyncState {
  active: boolean;
  totalQueued: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentPhotoId: string | null;
  trigger: BackgroundSyncTrigger | null;
  lastRunAt: string | null;
  nextRetryAt: string | null;
}

export const INITIAL_BACKGROUND_SYNC_STATE: BackgroundSyncState = {
  active: false,
  totalQueued: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentPhotoId: null,
  trigger: null,
  lastRunAt: null,
  nextRetryAt: null,
};

export interface PhotoBackgroundSyncOptions {
  getPendingPhotos: () => BackgroundSyncPhotoItem[];
  canSync: () => boolean;
  uploadPhoto: (item: BackgroundSyncPhotoItem) => Promise<boolean>;
  onStateChange: (state: BackgroundSyncState) => void;
  onSweepComplete?: (summary: {
    trigger: BackgroundSyncTrigger;
    succeeded: number;
    failed: number;
    total: number;
  }) => void;
}

const BACKOFF_DELAYS_MS = [15_000, 35_000, 75_000];
const PERIODIC_SWEEP_INTERVAL_MS = 45_000;

/**
 * Background sync service that listens to browser 'online' / 'offline',
 * tab visibility events, and a lightweight periodic sweep timer to
 * automatically sync any photo proofs with an 'error' or 'local' uploadState
 * across active and saved local reports while reporting live sync progress.
 */
export class PhotoBackgroundSyncService {
  private options: PhotoBackgroundSyncOptions;
  private state: BackgroundSyncState = { ...INITIAL_BACKGROUND_SYNC_STATE };
  private running = false;
  private stopped = false;
  private rerunTrigger: BackgroundSyncTrigger | null = null;
  private retryTimerId: number | null = null;
  private periodicTimerId: number | null = null;
  private backoffAttempt = 0;

  constructor(options: PhotoBackgroundSyncOptions) {
    this.options = options;
  }

  public updateOptions(options: PhotoBackgroundSyncOptions): void {
    this.options = options;
  }

  public start(): void {
    this.stopped = false;
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.startPeriodicSweep();
  }

  public stop(): void {
    this.stopped = true;
    this.clearScheduledRetry();
    this.stopPeriodicSweep();
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
  }

  public resetBackoff(): void {
    this.backoffAttempt = 0;
    this.clearScheduledRetry();
  }

  public async triggerSync(trigger: BackgroundSyncTrigger): Promise<void> {
    if (this.stopped) return;

    if (trigger === 'online' || trigger === 'manual' || trigger === 'signin') {
      this.backoffAttempt = 0;
      this.clearScheduledRetry();
    }

    if (!this.options.canSync()) {
      return;
    }

    if (this.running) {
      // Coalesce concurrent triggers into a single follow-up pass
      this.rerunTrigger = trigger;
      return;
    }

    const pending = this.options.getPendingPhotos();
    if (pending.length === 0) {
      if (this.state.active || this.state.nextRetryAt) {
        this.emitState({
          ...this.state,
          active: false,
          totalQueued: 0,
          completed: 0,
          currentPhotoId: null,
          nextRetryAt: null,
        });
      }
      return;
    }

    this.running = true;
    this.clearScheduledRetry();

    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    console.info('[BackgroundSync] Starting photo sync sweep', {
      trigger,
      queuedCount: pending.length,
      photoIds: pending.map((p) => p.photo.id),
    });

    this.emitState({
      ...this.state,
      active: true,
      totalQueued: pending.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentPhotoId: pending[0]?.photo.id ?? null,
      trigger,
      nextRetryAt: null,
    });

    try {
      for (const entry of pending) {
        if (this.stopped || !this.options.canSync()) {
          console.info(
            '[BackgroundSync] Paused sweep because device went offline or signed out'
          );
          break;
        }

        this.emitState({
          ...this.state,
          active: true,
          totalQueued: pending.length,
          completed,
          succeeded,
          failed,
          currentPhotoId: entry.photo.id,
          trigger,
        });

        let ok = false;
        try {
          ok = await this.options.uploadPhoto(entry);
        } catch {
          ok = false;
        }

        completed += 1;
        if (ok) succeeded += 1;
        else failed += 1;

        this.emitState({
          ...this.state,
          active: true,
          totalQueued: pending.length,
          completed,
          succeeded,
          failed,
          currentPhotoId: entry.photo.id,
          trigger,
        });
      }
    } finally {
      this.running = false;
      const finishedAt = new Date().toISOString();

      let nextRetryAt: string | null = null;
      if (
        !this.stopped &&
        failed > 0 &&
        this.options.canSync() &&
        this.backoffAttempt < BACKOFF_DELAYS_MS.length
      ) {
        const delayMs = BACKOFF_DELAYS_MS[this.backoffAttempt];
        this.backoffAttempt += 1;
        nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        this.retryTimerId = window.setTimeout(() => {
          this.retryTimerId = null;
          void this.triggerSync('scheduled');
        }, delayMs);
        console.info('[BackgroundSync] Scheduled follow-up retry', {
          delayMs,
          backoffAttempt: this.backoffAttempt,
          remainingFailed: failed,
        });
      } else if (failed === 0) {
        this.backoffAttempt = 0;
      }

      this.emitState({
        active: false,
        totalQueued: pending.length,
        completed,
        succeeded,
        failed,
        currentPhotoId: null,
        trigger,
        lastRunAt: finishedAt,
        nextRetryAt,
      });

      this.options.onSweepComplete?.({
        trigger,
        succeeded,
        failed,
        total: pending.length,
      });

      const pendingFollowUp = this.rerunTrigger;
      this.rerunTrigger = null;
      if (pendingFollowUp && !this.stopped && this.options.canSync()) {
        void this.triggerSync(pendingFollowUp);
      }
    }
  }

  private handleOnline = (): void => {
    console.info(
      '[BackgroundSync] navigator online event detected — checking pending/failed photos'
    );
    this.resetBackoff();
    // Brief settle delay (600ms) so network sockets/DNS stabilize right after reconnect
    window.setTimeout(() => {
      void this.triggerSync('online');
    }, 600);
  };

  private handleOffline = (): void => {
    this.clearScheduledRetry();
    if (this.state.nextRetryAt) {
      this.emitState({ ...this.state, nextRetryAt: null });
    }
  };

  private handleVisibilityChange = (): void => {
    if (
      document.visibilityState === 'visible' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine
    ) {
      const pending = this.options.getPendingPhotos();
      if (pending.length > 0 && this.options.canSync()) {
        void this.triggerSync('visibility');
      }
    }
  };

  private startPeriodicSweep(): void {
    this.stopPeriodicSweep();
    this.periodicTimerId = window.setInterval(() => {
      if (
        this.stopped ||
        this.running ||
        this.retryTimerId !== null ||
        document.visibilityState !== 'visible' ||
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        !this.options.canSync()
      ) {
        return;
      }
      if (this.options.getPendingPhotos().length > 0) {
        void this.triggerSync('scheduled');
      }
    }, PERIODIC_SWEEP_INTERVAL_MS);
  }

  private stopPeriodicSweep(): void {
    if (this.periodicTimerId !== null) {
      window.clearInterval(this.periodicTimerId);
      this.periodicTimerId = null;
    }
  }

  private clearScheduledRetry(): void {
    if (this.retryTimerId !== null) {
      window.clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
  }

  private emitState(next: BackgroundSyncState): void {
    this.state = next;
    this.options.onStateChange(next);
  }
}
