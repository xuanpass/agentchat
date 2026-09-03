import { createRouter, createWebHistory } from 'vue-router';
import { getApiKey } from '../api/client';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { title: '登录' } },
    { path: '/dashboard', name: 'dashboard', component: () => import('../pages/DashboardPage.vue'), meta: { title: '仪表盘' } },
    { path: '/connections', name: 'connections', component: () => import('../pages/ConnectionsPage.vue'), meta: { title: '智能体' } },
    { path: '/teams', name: 'teams', component: () => import('../pages/TeamsPage.vue'), meta: { title: '团队' } },
    { path: '/runs', name: 'runs', component: () => import('../pages/RunsPage.vue'), meta: { title: '运行记录' } },
    { path: '/sessions', name: 'sessions', component: () => import('../pages/SessionsPage.vue'), meta: { title: '会话' } },
    { path: '/capabilities', name: 'capabilities', component: () => import('../pages/CapabilitiesPage.vue'), meta: { title: '能力库' } },
    { path: '/projects', name: 'projects', component: () => import('../pages/ProjectsPage.vue'), meta: { title: '项目' } },
    { path: '/skill-market', name: 'skill-market', component: () => import('../pages/SkillMarketPage.vue'), meta: { title: '技能市场' } },
    { path: '/search', name: 'search', component: () => import('../pages/SearchPage.vue'), meta: { title: '搜索' } },
    { path: '/alerts', name: 'alerts', component: () => import('../pages/AlertsPage.vue'), meta: { title: '告警中心' } },
    { path: '/audit', name: 'audit', component: () => import('../pages/AuditPage.vue'), meta: { title: '审计日志' } },
    { path: '/token-usage', name: 'token-usage', component: () => import('../pages/TokenUsagePage.vue'), meta: { title: 'Token 用量' } },
    { path: '/alert-rules', name: 'alert-rules', component: () => import('../pages/AlertRulesPage.vue'), meta: { title: '告警规则' } },
    { path: '/workflows', name: 'workflows', component: () => import('../pages/WorkflowsPage.vue'), meta: { title: '编排工作流' } },
    { path: '/model-providers', name: 'model-providers', component: () => import('../pages/ModelProvidersPage.vue'), meta: { title: '多模型' } },
    { path: '/agent-monitor', name: 'agent-monitor', component: () => import('../pages/AgentMonitorPage.vue'), meta: { title: '监控' } },
    { path: '/plugin-market', name: 'plugin-market', component: () => import('../pages/PluginMarketPage.vue'), meta: { title: '插件市场' } },
    { path: '/agent-chat', name: 'agent-chat', component: () => import('../pages/AgentChatPage.vue'), meta: { title: '聊天中心' } },
    { path: '/notifications', name: 'notifications', component: () => import('../pages/NotificationsPage.vue'), meta: { title: '通知中心' } },
    { path: '/system-health', name: 'system-health', component: () => import('../pages/SystemHealthPage.vue'), meta: { title: '系统健康' } },
    { path: '/reports', name: 'reports', component: () => import('../pages/ReportsPage.vue'), meta: { title: '报告中心' } },
    { path: '/data-management', name: 'data-management', component: () => import('../pages/DataManagementPage.vue'), meta: { title: '数据管理' } },
    { path: '/dashboard-customize', name: 'dashboard-customize', component: () => import('../pages/DashboardCustomizePage.vue'), meta: { title: '仪表盘定制' } },
    { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue'), meta: { title: '设置' } },
  ],
});

// 鉴权守卫
router.beforeEach((to) => {
  const key = getApiKey();
  if (!key && to.name !== 'login') {
    return { name: 'login' };
  }
  if (key && to.name === 'login') {
    return { path: '/dashboard' };
  }
});
