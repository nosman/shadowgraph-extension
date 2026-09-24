import { getBaseUrl } from "./lib.js";

const select = document.getElementById("base-url");
const status = document.getElementById("status");

select.value = await getBaseUrl();
select.addEventListener("change", async () => {
  await chrome.storage.sync.set({ baseUrl: select.value });
  status.textContent = "Saved";
});
