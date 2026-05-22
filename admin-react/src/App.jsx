import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Suppliers from "./pages/Suppliers";
import Orders from "./pages/Orders";
import Transactions from "./pages/Transactions";
import Customers from "./pages/Customers";
import Promotions from "./pages/Promotions";
import ApiConnections from "./pages/ApiConnections";
import ApiDocs from "./pages/ApiDocs";
import BotConfig from "./pages/bot/BotConfig";
import BotLogs from "./pages/bot/BotLogs";
import Payment from "./pages/system/Payment";
import Plans from "./pages/system/Plans";
import Referral from "./pages/system/Referral";
import Settings from "./pages/system/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="orders" element={<Orders />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="customers" element={<Customers />} />
        <Route path="promotions" element={<Promotions />} />
        <Route path="api-connections" element={<ApiConnections />} />
        <Route path="api-docs" element={<ApiDocs />} />
        <Route path="bot/config" element={<BotConfig />} />
        <Route path="bot/logs" element={<BotLogs />} />
        <Route path="system/payment" element={<Payment />} />
        <Route path="system/plans" element={<Plans />} />
        <Route path="system/referral" element={<Referral />} />
        <Route path="system/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
