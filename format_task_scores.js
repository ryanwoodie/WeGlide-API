function formatTaskScores(taskInfo, isWeGlideBest, dmstFreeIsBest, dmstTaskIsBest) {
  const formatPoints = (points) => Number.isFinite(points) ? points.toFixed(1) : '—';
  const formatDistance = (km) => Number.isFinite(km) ? `${km.toFixed(1)} km` : '—';
  const formatResult = (base, points, isBest, css = 'score-check') => {
    const value = `${base} (${formatPoints(points)})`;
    const marker = isBest ? '✓' : '';
    return { value, css: isBest ? `${css} active` : css, marker };
  };

  const dmstFreeRow = formatResult('DMSt Free Score', taskInfo.dmstFreePoints, dmstFreeIsBest);

  const taskLabel = taskInfo.completed
    ? 'WeGlide/DMSt Task Score'
    : 'WeGlide/DMSt Task Score (not finished)';
  const dmstTaskRow = formatResult(
    `${taskLabel} – ${formatDistance(taskInfo.distanceKm)}`,
    taskInfo.completed ? taskInfo.dmstTaskActualPoints : taskInfo.dmstTaskPotentialPoints,
    dmstTaskIsBest,
    taskInfo.completed ? 'score-check' : 'score-check score-cross'
  );
  if (!taskInfo.completed && dmstTaskRow.marker) {
    dmstTaskRow.marker = '✗';
  }

  const weglideRow = formatResult(
    'WeGlide Free Score',
    taskInfo.freePoints,
    isWeGlideBest
  );

  return { dmstFreeRow, dmstTaskRow, weglideRow };
}
