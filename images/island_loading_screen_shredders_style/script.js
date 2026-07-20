const loadingScreen = document.getElementById("loadingScreen");
const sliceRow = document.getElementById("sliceRow");
const replay = document.getElementById("replay");

const SLICES = 13;
sliceRow.style.setProperty("--slices", SLICES);

for (let i = 0; i < SLICES; i++) {
  const slice = document.createElement("span");
  slice.className = "slice";
  slice.style.setProperty("--i", i);

  const img = document.createElement("img");
  img.src = "./island-logo.svg";
  img.alt = "";

  slice.appendChild(img);
  sliceRow.appendChild(slice);
}

// Demo auto-hide. Remove this timeout if this is your real loading screen.
function hideLoading() {
  loadingScreen.classList.add("is-hidden");
}

window.addEventListener("load", () => {
  setTimeout(hideLoading, 2800);
});

replay.addEventListener("click", () => {
  loadingScreen.classList.remove("is-hidden");
  void loadingScreen.offsetWidth;
  setTimeout(hideLoading, 2800);
});
