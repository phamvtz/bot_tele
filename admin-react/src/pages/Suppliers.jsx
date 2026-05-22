import { Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";

export default function Suppliers() {
  const navigate = useNavigate();
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Nhà cung cấp</h1>
      <p className="text-sm text-gray-500 mb-5">0 nhà cung cấp</p>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <EmptyState
          icon={Truck}
          message="Chưa có nhà cung cấp nào"
          action="Cấu hình API Provider"
          onAction={() => navigate("/api-connections")}
        />
      </div>
    </div>
  );
}
