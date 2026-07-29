import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Layout() {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <TopBar />
      {/* w-[calc(100%-14rem)] + overflow-x-hidden: main chỉ chiếm phần còn lại sau sidebar
          (14rem = w-56) và cắt tràn ngang, tránh nội dung dài đẩy layout rộng quá viewport
          làm cột phải bị cắt cụt. min-w-0 cho phép flex/grid con co lại đúng. */}
      <main className="ml-56 w-[calc(100%-14rem)] pt-12 min-h-screen overflow-x-hidden">
        <div className="p-6 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
