import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  Package,
  Radio,
  Route,
  Settings,
  Truck,
  UserRound,
  Users,
  Bell
} from 'lucide-react';

export const ADMIN_NAV_ITEMS = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'DELIVERIES', label: 'Deliveries', icon: Package },
  { id: 'ROUTES', label: 'Route Planner', icon: Route },
  { id: 'LIVE_TRACKING', label: 'Live Tracking', icon: Radio },
  { id: 'DRIVERS', label: 'Drivers', icon: Users },
  { id: 'CUSTOMERS', label: 'Customers', icon: UserRound },
  { id: 'FLEET', label: 'Fleet Management', icon: Truck },
  { id: 'ANALYTICS', label: 'Analytics & Reports', icon: BarChart3 },
  { id: 'PAYMENTS', label: 'Payments', icon: CreditCard },
  { id: 'NOTIFICATIONS', label: 'Notifications', icon: Bell },
  { id: 'SETTINGS', label: 'Settings', icon: Settings }
];
