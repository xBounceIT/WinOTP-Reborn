export function LoadingScreen() {
  return (
    <main
      className="loading-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="loading-screen-title"
    >
      <img className="loading-screen__logo" src="./app.ico" alt="" aria-hidden="true" />
      <span id="loading-screen-title" className="loading-screen__label">
        Loading...
      </span>
    </main>
  );
}
