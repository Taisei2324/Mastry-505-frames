const cursor = document.getElementById("customCursor");

let x = innerWidth / 2;
let y = innerHeight / 2;
let cx = x;
let cy = y;
let loadingTimer;

function move(e) {
  x = e.clientX;
  y = e.clientY;
}

function loop() {
  cx += (x - cx) * 0.32;
  cy += (y - cy) * 0.32;
  cursor.style.transform = `translate3d(${cx - 36}px, ${cy - 36}px, 0)`;
  requestAnimationFrame(loop);
}

function triggerCursorLoading() {
  cursor.classList.remove("loading");
  void cursor.offsetWidth;
  cursor.classList.add("loading");

  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    cursor.classList.remove("loading");
  }, 760);
}

addEventListener("pointermove", move, { passive: true });
addEventListener("pointerdown", triggerCursorLoading);
document.querySelectorAll("a, button").forEach(el => {
  el.addEventListener("mouseenter", triggerCursorLoading);
});

loop();
