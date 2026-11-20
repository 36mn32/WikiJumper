const API_URL = "https://en.wikipedia.org/w/api.php";

const elements = {
  answerArea: document.querySelector("#answer-area"),
  answerForm: document.querySelector("#answer-form"),
  answerInput: document.querySelector("#answer-input"),
  articleImage: document.querySelector("#article-image"),
  articleTitle: document.querySelector("#article-title"),
  gameMessage: document.querySelector("#game-message"),
  gameOver: document.querySelector("#game-over"),
  gameOverCopy: document.querySelector("#game-over-copy"),
  highScore: document.querySelector("#high-score"),
  imageFallback: document.querySelector("#image-fallback"),
  linkCount: document.querySelector("#link-count"),
  playAgain: document.querySelector("#play-again"),
  score: document.querySelector("#score"),
  submitButton: document.querySelector("#submit-button"),
  trailCount: document.querySelector("#trail-count"),
  trailList: document.querySelector("#trail-list"),
  wikiLink: document.querySelector("#wiki-link"),
};

const HIGH_SCORE_KEY = "wikijumper-high-score";
let currentArticle = null;
let score = 0;
let highScore = 0;
let trail = [];
let isGameOver = false;
let isSubmitting = false;

function normalizeTitle(title) {
  return title.trim().replaceAll("_", " ").replace(/\s+/g, " ").toLocaleLowerCase();
}

async function requestWikipedia(parameters) {
  const query = new URLSearchParams({
    ...parameters,
    action: "query",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`${API_URL}?${query}`);
  if (!response.ok) {
    throw new Error(`Wikipedia returned ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.info || "Wikipedia could not load that article.");
  }
  return data;
}

async function getRandomArticleTitle() {
  const data = await requestWikipedia({
    list: "random",
    rnnamespace: "0",
    rnlimit: "1",
  });
  const title = data.query.random?.[0]?.title;
  if (!title) {
    throw new Error("Wikipedia did not return a random article.");
  }
  return title;
}

async function loadArticle(title) {
  const data = await requestWikipedia({
    titles: title,
    prop: "pageimages|links",
    piprop: "thumbnail",
    pithumbsize: "1200",
    plnamespace: "0",
    pllimit: "max",
  });
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia could not find “${title}”.`);
  }
  return {
    title: page.title,
    image: page.thumbnail?.source ?? null,
    links: (page.links ?? []).map((link) => link.title),
    continuation: data.continue ?? null,
  };
}

async function findLinkedArticle(article, answer) {
  const normalizedAnswer = normalizeTitle(answer);
  let links = article.links;
  let continuation = article.continuation;

  while (true) {
    const match = links.find((title) => normalizeTitle(title) === normalizedAnswer);
    if (match) return match;
    if (!continuation) return null;

    const data = await requestWikipedia({
      titles: article.title,
      prop: "links",
      plnamespace: "0",
      pllimit: "max",
      ...continuation,
    });
    const page = Object.values(data.query.pages)[0];
    links = (page?.links ?? []).map((link) => link.title);
    continuation = data.continue ?? null;
  }
}

function setLoading(loading) {
  elements.answerInput.disabled = loading || isGameOver || !currentArticle;
  elements.submitButton.disabled = loading || isGameOver || !currentArticle;
  elements.submitButton.innerHTML = loading
    ? "<span>Checking</span><span aria-hidden=\"true\">…</span>"
    : "<span>Go</span><span aria-hidden=\"true\">→</span>";
  isSubmitting = loading;
}

function renderArticle(article) {
  currentArticle = article;
  elements.articleTitle.textContent = article.title;
  elements.linkCount.textContent = "Choose a link to follow";
  elements.wikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title.replaceAll(" ", "_"))}`;
  if (article.image) {
    elements.articleImage.src = article.image;
    elements.articleImage.alt = `Lead image from the Wikipedia article ${article.title}`;
    elements.articleImage.hidden = false;
    elements.imageFallback.hidden = true;
  } else {
    elements.articleImage.removeAttribute("src");
    elements.articleImage.alt = "";
    elements.articleImage.hidden = true;
    elements.imageFallback.hidden = false;
  }
  elements.answerInput.disabled = false;
  elements.submitButton.disabled = false;
}

function renderTrail() {
  elements.trailList.replaceChildren();
  for (const [index, title] of trail.entries()) {
    const item = document.createElement("li");
    item.className = `trail-item${index === trail.length - 1 ? " trail-current" : ""}`;

    const marker = document.createElement("span");
    marker.className = "trail-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.append(document.createElement("span"));

    const label = document.createElement("span");
    label.className = "trail-title";
    label.textContent = title;
    item.append(marker, label);
    elements.trailList.append(item);
  }
  elements.trailCount.textContent = `${String(trail.length).padStart(2, "0")} ${trail.length === 1 ? "PAGE" : "PAGES"}`;
  elements.score.textContent = String(score).padStart(2, "0");
  elements.highScore.textContent = String(highScore).padStart(2, "0");
}

function showMessage(message, type = "error") {
  elements.gameMessage.textContent = message;
  elements.gameMessage.classList.toggle("success", type === "success");
}

function loadHighScore() {
  try {
    const savedScore = Number(window.localStorage.getItem(HIGH_SCORE_KEY));
    return Number.isSafeInteger(savedScore) && savedScore >= 0 ? savedScore : 0;
  } catch (error) {
    showMessage(`Could not load your saved high score: ${error.message}`);
    return 0;
  }
}

function saveHighScore() {
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    return true;
  } catch (error) {
    showMessage(`Could not save your high score: ${error.message}`);
    return false;
  }
}

function endGame() {
  isGameOver = true;
  setLoading(false);
  elements.answerArea.hidden = true;
  elements.gameOver.hidden = false;
  elements.gameOverCopy.textContent = `“${elements.answerInput.value.trim()}” isn't linked from ${currentArticle.title}. You followed ${score} ${score === 1 ? "link" : "links"} — ready to wander again?`;
  elements.playAgain.focus();
}

async function startGame() {
  isGameOver = false;
  score = 0;
  trail = [];
  currentArticle = null;
  elements.answerArea.hidden = false;
  elements.gameOver.hidden = true;
  elements.articleTitle.textContent = "Getting your first page…";
  elements.answerInput.value = "";
  elements.answerInput.disabled = true;
  elements.submitButton.disabled = true;
  showMessage("");
  highScore = loadHighScore();
  renderTrail();

  try {
    const article = await loadArticle(await getRandomArticleTitle());
    trail.push(article.title);
    renderTrail();
    renderArticle(article);
    elements.answerInput.focus();
  } catch (error) {
    elements.articleTitle.textContent = "Couldn’t load your page";
    showMessage(`${error.message} Check your connection and try again.`, "error");
    elements.answerInput.disabled = true;
    elements.submitButton.disabled = true;
    elements.gameOver.hidden = false;
    elements.gameOverCopy.textContent = "Wikipedia couldn’t be reached just now. Check your connection and start a new journey.";
    elements.answerArea.hidden = true;
    elements.playAgain.textContent = "Try again";
  }
}

elements.answerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting || isGameOver || !currentArticle) return;

  const answer = elements.answerInput.value.trim();
  if (!answer) {
    showMessage("Type an article title to follow the trail.");
    elements.answerInput.focus();
    return;
  }

  setLoading(true);
  showMessage("");
  try {
    const linkedTitle = await findLinkedArticle(currentArticle, answer);
    if (!linkedTitle) {
      endGame();
      return;
    }

    showMessage("A new path appears…", "success");
    const nextArticle = await loadArticle(linkedTitle);
    score += 1;
    let highScoreSaved = true;
    if (score > highScore) {
      highScore = score;
      highScoreSaved = saveHighScore();
    }
    trail.push(nextArticle.title);
    renderTrail();
    renderArticle(nextArticle);
    elements.answerInput.value = "";
    if (highScoreSaved) showMessage("Nice jump. Where to next?", "success");
  } catch (error) {
    showMessage(`${error.message} Please try again.`, "error");
  } finally {
    if (!isGameOver) setLoading(false);
  }
});

elements.playAgain.addEventListener("click", () => {
  elements.playAgain.textContent = "Start a new journey";
  startGame();
});

startGame();
