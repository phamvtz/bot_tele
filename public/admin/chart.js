// Studio Waveform & Telemetry Chart Library
function drawRevenueChart(data) {
  const canvas = document.getElementById('revenue-chart');
  if (!canvas) return;
  
  // High-DPI sharpness
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  
  const W = rect.width;
  const H = rect.height;
  const padTop = 18, padBottom = 26, padLeft = 14, padRight = 14;
  
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;
  
  if (!data || !data.length) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#64748b';
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('NO TELEMETRY DATA', W / 2, H / 2);
    return;
  }

  // Extract values
  const values = data.map(d => d.revenue || 0);
  const maxVal = Math.max(...values, 1000);
  
  // Clear canvas
  ctx.clearRect(0, 0, W, H);
  
  // Grid Lines (Technical Instrumentation)
  ctx.strokeStyle = 'rgba(33, 40, 56, 0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  
  for (let i = 0; i <= 4; i++) {
    const y = padTop + chartH - (chartH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  
  // Calculate Points
  const points = data.map((d, i) => {
    const x = padLeft + (chartW * i / Math.max(1, data.length - 1));
    const y = padTop + chartH - (chartH * (d.revenue || 0) / maxVal);
    const dateParts = (d.date || '').split('-');
    const label = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : d.date;
    return { x, y, label, val: d.revenue || 0 };
  });
  
  // Draw Smooth Waveform Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const xc = (points[i - 1].x + points[i].x) / 2;
    const yc = (points[i - 1].y + points[i].y) / 2;
    ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  // Draw Subtle Area Glow
  const gradient = ctx.createLinearGradient(0, padTop, 0, H - padBottom);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
  
  ctx.lineTo(points[points.length - 1].x, padTop + chartH);
  ctx.lineTo(points[0].x, padTop + chartH);
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Draw Technical Nodes & Labels
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  
  points.forEach((p) => {
    // Node
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#10141d';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();
    
    // Bottom Timestamp
    ctx.fillStyle = '#64748b';
    ctx.fillText(p.label, p.x, H - 6);
  });
}
