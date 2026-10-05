// Debug harness: log every moveend + what fired it
window.__moveEvents = [];
window.__origMoveend = state.map.events._eventHandlers?.moveend?.slice() || [];
state.map.on('moveend', (e) => {
  try {
    window.__moveEvents.push({
      t: Date.now() - window.__t0 || Date.now(),
      z: state.map.getZoom(),
      c: [state.map.getCenter().lng, state.map.getCenter().lat],
      pg: state.playgrounds.length,
      src: e.source || 'unknown',
    });
  } catch(err) {}
});
setTimeout(() => console.log('MOVEEND LOG:', window.__moveEvents), 20000);