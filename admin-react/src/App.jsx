import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Products = lazy(() => import("./pages/Products"));
const Categories = lazy(() => import("./pages/Categories"));
const Orders = lazy(() => import("./pages/Orders"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Customers = lazy(() => import("./pages/Customers"));
const Promotions = lazy(() => import("./pages/Promotions"));
const FlashSales = lazy(() => import("./pages/FlashSales"));
const Giftcodes = lazy(() => import("./pages/Giftcodes"));
const ApiConnections = lazy(() => import("./pages/ApiConnections"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const SellerApi = lazy(() => import("./pages/SellerApi"));
const ApiKeyShop = lazy(() => import("./pages/ApiKeyShop"));
const BotConfig = lazy(() => import("./pages/bot/BotConfig"));
const BotLogs = lazy(() => import("./pages/bot/BotLogs"));
const Broadcast = lazy(() => import("./pages/bot/Broadcast"));
const UserActivity = lazy(() => import("./pages/bot/UserActivity"));
const Payment = lazy(() => import("./pages/system/Payment"));
const Plans = lazy(() => import("./pages/system/Plans"));
const Referral = lazy(() => import("./pages/system/Referral"));
const Settings = lazy(() => import("./pages/system/Settings"));
const BankMonitor = lazy(() => import("./pages/system/BankMonitor"));
const StockEntry = lazy(() => import("./pages/StockEntry"));
const Complaints = lazy(() => import("./pages/Complaints"));
const QuantityDiscounts = lazy(() => import("./pages/QuantityDiscounts"));
const ResellerOrders = lazy(() => import("./pages/ResellerOrders"));
const ScheduledBroadcast = lazy(() => import("./pages/bot/ScheduledBroadcast"));
const SepayDebug = lazy(() => import("./pages/system/SepayDebug"));
const DatabaseViewer = lazy(() => import("./pages/system/DatabaseViewer"));
const KeyOrders = lazy(() => import("./pages/KeyOrders"));
const ApiKeyManagement = lazy(() => import("./pages/ApiKeyManagement"));

function RequireAuth({ children }) {
  return localStorage.getItem("admin_token") ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="suppliers" element={<Navigate to="/api-connections" replace />} />
        <Route path="orders" element={<Orders />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="customers" element={<Customers />} />
        <Route path="promotions" element={<Promotions />} />
        <Route path="flash-sales" element={<FlashSales />} />
        <Route path="giftcodes" element={<Giftcodes />} />
        <Route path="stock" element={<StockEntry />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="quantity-discounts" element={<QuantityDiscounts />} />
        <Route path="reseller-orders" element={<ResellerOrders />} />
        <Route path="key-orders" element={<KeyOrders />} />
        <Route path="api-keys" element={<ApiKeyManagement />} />
        <Route path="api-connections" element={<ApiConnections />} />
        <Route path="api-key-shop" element={<ApiKeyShop />} />
        <Route path="api-docs" element={<ApiDocs />} />
        <Route path="seller-api" element={<SellerApi />} />
        <Route path="bot/config" element={<BotConfig />} />
        <Route path="bot/broadcast" element={<Broadcast />} />
        <Route path="bot/schedule" element={<ScheduledBroadcast />} />
        <Route path="bot/logs" element={<BotLogs />} />
        <Route path="bot/user-activity" element={<UserActivity />} />
        <Route path="system/payment" element={<Payment />} />
        <Route path="system/plans" element={<Plans />} />
        <Route path="system/referral" element={<Referral />} />
        <Route path="system/bank" element={<BankMonitor />} />
        <Route path="system/sepay" element={<SepayDebug />} />
        <Route path="system/database" element={<DatabaseViewer />} />
        <Route path="system/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
