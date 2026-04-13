import { ref, onMounted } from 'vue'

export interface AuthUser {
  id:    string
  email: string
  name:  string
  role:  'pending' | 'editor' | 'admin' | 'denied'
}

const user = ref<AuthUser | null>(null)
const loading = ref(true)

async function fetchUser(): Promise<void> {
  try {
    const res = await fetch('/auth/me')
    if (res.ok) {
      user.value = await res.json() as AuthUser
    } else {
      user.value = null
    }
  } catch {
    user.value = null
  } finally {
    loading.value = false
  }
}

export function useAuth() {
  onMounted(() => {
    if (loading.value) void fetchUser()
  })

  return { user, loading, refetch: fetchUser }
}
