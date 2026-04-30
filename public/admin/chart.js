// Mini chart library cho Admin Panel
function drawRevenueChart(data) {
  const canvas = document.getElementById('revenue-chart');
  if (!canvas) return;
  
  // Set physical pixels for sharpness
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  
  const W = rect.width;
  const H = rect.height;
  const padTop = 20, padBottom = 24, padLeft = 10, padRight = 10;
  
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;
  
  // Extract values
  const values = data.map(d => d.revenue);
  const maxVal = Math.max(...values, 1000); // Tối thiểu 1000
  
  // Xóa nền
  ctx.clearRect(0, 0, W, H);
  
  // Grid ngang (4 dòng)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = padTop + chartH - (chartH * i / 4);
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
  }
  ctx.stroke();
  
  // Tính toán tọa độ điểm
  const points = data.map((d, i) => {
    const x = padLeft + (chartW * i / Math.max(1, data.length - 1));
    const y = padTop + chartH - (chartH * d.revenue / maxVal);
    // Format date: YYYY-MM-DD -> DD/MM
    const dateParts = d.date.split('-');
    const label = `${dateParts[2]}/${dateParts[1]}`;
    return {x, y, label, val: d.revenue};
  });
  
  // Vẽ đường cong (Line)
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    // Bézier curve đơn giản cho mượt
    const xc = (points[i-1].x + points[i].x) / 2;
    const yc = (points[i-1].y + points[i].y) / 2;
    ctx.quadraticCurveTo(points[i-1].x, points[i-1].y, xc, yc);
  }
  ctx.lineTo(points[points.length-1].x, points[points.length-1].y);
  
  ctx.strokeStyle = '#7c6ff7'; // Màu accent
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  // Vẽ gradient nền dưới đường line
  const gradient = ctx.createLinearGradient(0, padTop, 0, H - padBottom);
  gradient.addColorStop(0, 'rgba(124,111,247,0.3)');
  gradient.addColorStop(1, 'rgba(124,111,247,0)');
  
  ctx.lineTo(points[points.length-1].x, padTop + chartH);
  ctx.lineTo(points[0].x, padTop + chartH);
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Vẽ các điểm (Dots) & Nhãn
  ctx.font = '10px Inter';
  ctx.textAlign = 'center';
  
  points.forEach((p, i) => {
    // Chấm
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#141824'; // Màu nền surface2
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a78bfa';
    ctx.stroke();
    
    // Nhãn ngày tháng (dưới cùng)
    ctx.fillStyle = '#64748b';
    ctx.fillText(p.label, p.x, H - 4);
  });
}
