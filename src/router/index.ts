import { createRouter, createWebHistory } from 'vue-router'
import HomeView      from '../pages/HomeView.vue'
import MapView       from '../pages/MapView.vue'
import EventsView    from '../pages/EventsView.vue'
import StationsView  from '../pages/StationsView.vue'
import StationDetail from '../pages/StationDetail.vue'
import PeopleView    from '../pages/PeopleView.vue'
import PersonDetail  from '../pages/PersonDetail.vue'
import TransportView   from '../pages/TransportView.vue'
import TransportDetail from '../pages/TransportDetail.vue'
import OutlinesView  from '../pages/OutlinesView.vue'
import OutlineDetail from '../pages/OutlineDetail.vue'
import RegistreView  from '../pages/RegistreView.vue'
import AboutView     from '../pages/AboutView.vue'
import AccessView    from '../pages/AccessView.vue'
import ReviewView    from '../pages/ReviewView.vue'

const MAP_PARAMS = ['lat', 'lng', 'z', 'orgs', 'dists', 'q', 'si']

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',                        component: HomeView },
    { path: '/map',                     component: MapView },
    { path: '/map/:slug/:child?',       component: MapView },
    { path: '/events',                  component: EventsView },
    { path: '/events/:slug',            component: EventsView },
    // Redirects — old URL shapes
    { path: '/event/:slug/:child?', redirect: to => ({
      path: `/events/${[to.params.slug].flat()[0]}${to.params.child ? `/${[to.params.child].flat()[0]}` : ''}`,
      query: to.query,
    })},
    { path: '/directory', redirect: '/events' },
    { path: '/stations',                component: StationsView },
    { path: '/station/:slug',           component: StationDetail },
    { path: '/people',                  component: PeopleView },
    { path: '/person/:slug/:child?',    component: PersonDetail },
    { path: '/transport',               component: TransportView },
    { path: '/transport/:slug/:child?', component: TransportDetail },
    { path: '/outlines',                component: OutlinesView },
    { path: '/outlines/:slug',          component: OutlineDetail },
    { path: '/registre',               component: RegistreView },
    { path: '/about',                   component: AboutView },
    { path: '/access',                  component: AccessView },
    { path: '/review',                  component: ReviewView },
  ],
})

router.beforeEach((to, from) => {
  const leavingMap = from.path.startsWith('/map')
  const enteringMap = to.path.startsWith('/map')
  if (leavingMap && !enteringMap && MAP_PARAMS.some(k => k in to.query)) {
    const query = { ...to.query }
    for (const k of MAP_PARAMS) delete query[k]
    return { ...to, query }
  }
})

export default router
