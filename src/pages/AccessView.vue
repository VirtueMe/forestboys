<template>
  <div class="access-page">
    <div class="access-card">
      <div class="wip-banner">Under utvikling — ikke klar til bruk</div>
      <h1 class="access-title">Redaktørtilgang</h1>

      <div v-if="loading" class="access-state">
        <p class="state-text muted">Laster…</p>
      </div>

      <!-- Not logged in -->
      <div v-else-if="!user" class="access-state">
        <p class="state-text">
          Logg inn med Google for å be om tilgang som redaktør.
        </p>
        <a href="/auth/google" class="btn btn-google">
          <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Logg inn med Google
        </a>
      </div>

      <!-- Pending -->
      <div v-else-if="user.role === 'pending'" class="access-state">
        <div class="status-badge status-pending">Venter på godkjenning</div>
        <p class="state-text">
          Innlogget som <strong>{{ user.name }}</strong> ({{ user.email }}).<br />
          Forespørselen din er sendt — en administrator vil godkjenne den snart.
        </p>
        <form method="POST" action="/auth/logout">
          <button class="btn btn-secondary" type="submit">Logg ut</button>
        </form>
      </div>

      <!-- Denied -->
      <div v-else-if="user.role === 'denied'" class="access-state">
        <div class="status-badge status-denied">Tilgang avvist</div>
        <p class="state-text">
          Tilgang som redaktør ble ikke innvilget for <strong>{{ user.email }}</strong>.
        </p>
        <form method="POST" action="/auth/logout">
          <button class="btn btn-secondary" type="submit">Logg ut</button>
        </form>
      </div>

      <!-- Editor or admin -->
      <div v-else class="access-state">
        <div class="status-badge status-active">
          {{ user.role === 'admin' ? 'Administrator' : 'Redaktør' }}
        </div>
        <p class="state-text">
          Innlogget som <strong>{{ user.name }}</strong> ({{ user.email }}).
        </p>
        <div class="access-actions">
          <RouterLink to="/" class="btn btn-primary">Til forsiden</RouterLink>
          <form method="POST" action="/auth/logout">
            <button class="btn btn-secondary" type="submit">Logg ut</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAuth } from '../composables/useAuth.ts'

const { user, loading } = useAuth()
</script>

<style scoped>
.access-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--color-bg);
}

.access-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.wip-banner {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  padding: 6px 10px;
  text-align: center;
}

.access-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.access-state {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.state-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text);
  margin: 0;
}
.state-text.muted { color: var(--color-muted); }

.status-badge {
  display: inline-flex;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 20px;
}
.status-pending { background: #fff8e1; color: #b45309; }
.status-denied  { background: #fef2f2; color: #b91c1c; }
.status-active  { background: #f0fdf4; color: #15803d; }

.access-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.1s;
}
.btn:hover { opacity: 0.85; }

.btn-google {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  width: 100%;
  justify-content: center;
  padding: 11px 16px;
}

.btn-primary {
  background: var(--color-navy);
  color: #fff;
}

.btn-secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.google-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
