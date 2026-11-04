/* Prima embedded presentation controls; no change to dialog or Worker. */
const PRIMA_EMBED_CONTROL_V1 =
  window.self !== window.top &&
  new URLSearchParams(window.location.search).get('embed') === '1';

if (PRIMA_EMBED_CONTROL_V1) {
  document.documentElement.classList.add('prima-embedded-dialog-v1');
}

function primaNotifyHostV1(type) {
  if (!PRIMA_EMBED_CONTROL_V1) return false;
  window.parent.postMessage(
    { version: 'PrimaEmbedControlV1', type: type },
    'https://primadom.ai'
  );
  return true;
}

const API_BASE =
  window.PRIMA_WORKER_URL ||
  (
    ["localhost", "127.0.0.1"].includes(
      window.location.hostname
    )
      ? "http://localhost:8787"
      : "https://api.primadom.ai"
  );

const PRIMA_GREETING_V1 =
  "Hi, I’m Prima 👋 I’m an AI real estate advisor focused on the UAE market. How should I address you?";

const layer =
  document.getElementById("layer");

const mini =
  document.getElementById("mini");

const input =
  document.getElementById("input");

const dynamic =
  document.getElementById("dynamic");

const scroll =
  document.getElementById("scroll");

const sendButton =
  document.getElementById("send");

const minimizeButton =
  document.getElementById("minimize");

const closeButton =
  document.getElementById("close");


const state = {
  conversationId: null,
  conversationAccessToken: null,
  restoreBlocked: false,
    conversationStartPromise: null,
    conversationInitiator: null,
    greetingText: null,
    greetingShown: false,
    firstUserTurnPending: false,
    awaitingName: false,
  busy: false,
  turnSequence: 0,
  savedScrollTop: 0,
  searchContext: null,
  searchPagination: null,
  lastSearchQuery: "",
  pendingSearchContext: null
};


/*
  Day 3 — Prima Dialog → existing Primadom Search.

  Transport only.
  Search parsing / filtering / ranking stays in Primadom Search.
*/
const SEARCH_BRIDGE_URL =
  window.PRIMA_SEARCH_BRIDGE_URL ||
  (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:1313/en/"
      : "https://primadom.ai/en/"
  );

const SEARCH_BRIDGE_ORIGIN =
  new URL(
    SEARCH_BRIDGE_URL,
    window.location.href
  ).origin;

let searchBridgeFramePromise =
  null;


function ensureSearchBridgeFrame() {
  if (searchBridgeFramePromise) {
    return searchBridgeFramePromise;
  }

  searchBridgeFramePromise =
    new Promise(
      (resolve, reject) => {
        const frame =
          document.createElement(
            "iframe"
          );

        frame.setAttribute(
          "aria-hidden",
          "true"
        );

        frame.tabIndex = -1;

        Object.assign(
          frame.style,
          {
            position: "fixed",
            width: "1px",
            height: "1px",
            opacity: "0",
            pointerEvents: "none",
            border: "0"
          }
        );

        const timer =
          setTimeout(
            () => {
              reject(
                new Error(
                  "Prima Search bridge load timeout"
                )
              );
            },
            12000
          );

        frame.addEventListener(
          "load",
          () => {
            clearTimeout(timer);
            resolve(frame);
          },
          {
            once: true
          }
        );

        frame.addEventListener(
          "error",
          () => {
            clearTimeout(timer);

            reject(
              new Error(
                "Prima Search bridge failed to load"
              )
            );
          },
          {
            once: true
          }
        );

        frame.src =
          SEARCH_BRIDGE_URL;

        document.body.appendChild(
          frame
        );
      }
    )
    .catch(error => {
      searchBridgeFramePromise =
        null;

      throw error;
    });

  return searchBridgeFramePromise;
}


async function runPrimaProjectSearchBridge(
  request
) {
  const frame =
    await ensureSearchBridgeFrame();

  const requestId =
    globalThis.crypto?.randomUUID?.() ||
    (
      "prima-search-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2)
    );

  return new Promise(
    (resolve, reject) => {
      let finished =
        false;

      let timer =
        null;

      const finish = (
        fn,
        value
      ) => {
        if (finished) {
          return;
        }

        finished =
          true;

        if (timer) {
          clearTimeout(timer);
        }

        window.removeEventListener(
          "message",
          onMessage
        );

        fn(value);
      };

      const onMessage =
        event => {
          if (
            event.origin !==
              SEARCH_BRIDGE_ORIGIN ||
            event.source !==
              frame.contentWindow
          ) {
            return;
          }

          const payload =
            event.data;

          if (
            payload?.version !==
              "PrimaSearchBridgeV1" ||
            payload?.request_id !==
              requestId
          ) {
            return;
          }

          if (
            payload.type ===
              "prima:search_result"
          ) {
            finish(
              resolve,
              payload.search_context
            );

            return;
          }

          if (
            payload.type ===
              "prima:search_error"
          ) {
            finish(
              reject,
              new Error(
                payload.error ||
                "Prima Search failed"
              )
            );
          }
        };

      window.addEventListener(
        "message",
        onMessage
      );

      timer =
        setTimeout(
          () => {
            finish(
              reject,
              new Error(
                "Prima Search execution timeout"
              )
            );
          },
          12000
        );

      frame.contentWindow.postMessage(
        {
          version:
            "PrimaSearchBridgeV1",

          type:
            "prima:search_request",

          request_id:
            requestId,

          request
        },
        SEARCH_BRIDGE_ORIGIN
      );
    }
  );
}


/*
  Isolated Prima preview defaults to the EN homepage.

  When embedded into the real Primadom site, the host page
  may provide window.PRIMA_CONTEXT with the actual page/entity.
*/
const DEFAULT_CONTEXT = {
  language: "en",

  page: {
    language_code: "en",
    page_id: null,
    page_type: "homepage",
    url_path: "/en/",
    canonical_url_path: "/en/"
  },

  entity: {
    primary_type: null,
    primary_slug: null,
    secondary_type: null,
    secondary_slug: null
  }
};


const CONTEXT =
  window.PRIMA_CONTEXT
    ? {
        ...DEFAULT_CONTEXT,
        ...window.PRIMA_CONTEXT,

        page: {
          ...DEFAULT_CONTEXT.page,
          ...(window.PRIMA_CONTEXT.page || {})
        },

        entity: {
          ...DEFAULT_CONTEXT.entity,
          ...(window.PRIMA_CONTEXT.entity || {})
        }
      }
    : DEFAULT_CONTEXT;


/*
  Reuse the existing Prima mark already present in V12.
  This avoids duplicating the large base64 image in JS.
*/
const avatarSrc =
  document.querySelector(
    "#scroll .avatar img"
  )?.src ||
  document.querySelector(
    ".logo-mark img"
  )?.src ||
  document.querySelector(
    ".mini-icon img"
  )?.src ||
  "";


/*
  Remove static V12 conversation demo at runtime,
  but preserve the intro and the live dynamic container.

  We deliberately do not rewrite the HTML yet.
*/
function removeDemoConversation() {
  const thread =
    dynamic?.parentElement;

  if (!thread) {
    return;
  }

  const intro =
    thread.querySelector(
      ":scope > .intro"
    );

  for (
    const child of
      Array.from(thread.children)
  ) {
    if (
      child === dynamic ||
      child === intro
    ) {
      continue;
    }

    child.remove();
  }

  dynamic.innerHTML = "";
}


function scrollToBottom(
  smooth = true
) {
  requestAnimationFrame(
    () => {
      scroll.scrollTo({
        top:
          scroll.scrollHeight,

        behavior:
          smooth
            ? "smooth"
            : "auto"
      });

      state.savedScrollTop =
        scroll.scrollTop;
    }
  );
}


function openDialog() {
  mini.classList.remove(
    "show"
  );

  layer.classList.remove(
    "hidden"
  );

  requestAnimationFrame(
    () => {
      scroll.scrollTop =
        state.savedScrollTop;
    }
  );

  setTimeout(
    () =>
      input.focus(),
    180
  );
}


function minimizeDialog() {
  if (primaNotifyHostV1('prima:embed:minimize')) return;
  state.savedScrollTop =
    scroll.scrollTop;

  layer.classList.add(
    "hidden"
  );

  setTimeout(
    () =>
      mini.classList.add(
        "show"
      ),
    140
  );
}


function setBusy(
  busy
) {
  state.busy =
    Boolean(busy);

  sendButton.disabled =
    state.busy;

  input.setAttribute(
    "aria-busy",
    state.busy
      ? "true"
      : "false"
  );
}


async function postJson(
  path,
  body
) {
  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          ...(path === "/api/prima/message" || path === "/api/prima/lead-context" || path === "/api/prima/conversation/restore"
            ? {Authorization: `Bearer ${state.conversationAccessToken || ""}`}
            : {})
        },

        body:
          JSON.stringify(
            body
          )
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}


  // RESTORE-01 — tab-scoped capability. Never persist in localStorage,
  // URL params, analytics or logs. A full return-after-tab-close contract
  // requires separate server-managed authentication (RESTORE-03).
  const PRIMA_RESTORE_SESSION_KEY_V1 = "prima.restore.session.v1";

  function storePrimaResumeCapabilityV1(conversationId, accessToken) {
    try {
      window.sessionStorage.setItem(PRIMA_RESTORE_SESSION_KEY_V1,
        JSON.stringify({
          version:1,
          conversation_id:conversationId,
          token:accessToken,
          saved_at:Date.now()
        })
      );
    } catch {
      // Privacy/storage settings may disable tab storage.
    }
  }

  function clearPrimaResumeCapabilityV1() {
    try {
      window.sessionStorage.removeItem(PRIMA_RESTORE_SESSION_KEY_V1);
    } catch {}
  }

  function readPrimaResumeCapabilityV1() {
    try {
      const record = JSON.parse(window.sessionStorage.getItem(
        PRIMA_RESTORE_SESSION_KEY_V1
      ) || "null");
      if (!record || record.version !== 1 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            String(record.conversation_id || "")) ||
          !/^[A-Za-z0-9_-]{43}$/.test(String(record.token || "")) ||
          !Number.isFinite(record.saved_at) ||
          record.saved_at > Date.now() + 60000 ||
          Date.now() - record.saved_at > 86400000) {
        clearPrimaResumeCapabilityV1();
        return null;
      }
      return record;
    } catch {
      clearPrimaResumeCapabilityV1();
      return null;
    }
  }

  // RESTORE-03A: keep a short-lived, server-signed HttpOnly cookie on the
  // API host. Never save the long-term cookie or server signature in JS.
  async function attachPrimaReturnSessionV1(conversationId, accessToken) {
    if (!conversationId || !accessToken) return;
    try {
      const response = await fetch(`${API_BASE}/api/prima/conversation/session/attach`, {
        method:"POST", credentials:"include", cache:"no-store",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${accessToken}`},
        body:JSON.stringify({conversation_id:conversationId})
      });
      // Existing tab-scoped RESTORE-01 always remains the fallback.
      if (!response.ok) console.warn("Prima browser return unavailable");
    } catch { /* Unsupported hosts do not block normal conversations. */ }
  }

  async function findPrimaBrowserReturnSessionV1() {
    const response = await fetch(`${API_BASE}/api/prima/conversation/session`, {
      method:"GET", credentials:"include", cache:"no-store"
    });
    if (!response.ok) throw new Error("return_session_request_failed");
    const data = await response.json();
    if (data?.status === "none") return null;
    if (data?.status !== "active" || data?.version !== "PrimaReturnSessionV1" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(data?.conversation_id || "")) ||
        !/^[A-Za-z0-9_-]{43}$/.test(String(data?.conversation_access_token || ""))) {
      throw new Error("invalid_return_session_response");
    }
    return {conversation_id:data.conversation_id,token:data.conversation_access_token};
  }

  async function restorePrimaConversationV1() {
    let previous = readPrimaResumeCapabilityV1();
    if (!previous) {
      try {
        previous = await findPrimaBrowserReturnSessionV1();
        if (previous) storePrimaResumeCapabilityV1(previous.conversation_id,previous.token);
      } catch (error) {
        // Fail closed on network/API errors: never silently replace a
        // potentially valid conversation with a new, empty one.
        console.warn("Prima return-session check failed",error?.message);
        state.restoreBlocked = true;
        dynamic.innerHTML = "";
        const assistant = createAssistantTurn(false);
        assistant.message.textContent =
          "Your conversation could not be checked right now. Please refresh to retry.";
        return "retry";
      }
    }
    if (!previous) return "new";

    state.conversationAccessToken = previous.token;
    state.restoreBlocked = false;
    setBusy(true);
    try {
      const data = await postJson("/api/prima/conversation/restore", {
        conversation_id:previous.conversation_id
      });
      if (!data || data.version !== "ConversationRestoreV1" ||
          data.conversation_id !== previous.conversation_id ||
          !Array.isArray(data.messages)) {
        throw new Error("invalid_restore_response");
      }
      if (data.history_truncated) {
        // Do not display partial history as if the conversation were complete.
        throw new Error("restore_history_truncated");
      }
      dynamic.innerHTML = "";
      for (const item of data.messages) {
        if (item.role === "user") {
          createUserTurn(String(item.content || ""));
        } else if (item.role === "assistant") {
          const assistant = createAssistantTurn(false);
          assistant.message.textContent = String(item.content || "");
          renderInlineBold(assistant.message);
          // RESTORE-02A: replay verified cards in their original turn order.
          // No new Search, model call, DB write or lead creation on refresh.
          if (Array.isArray(item.cards) && item.cards.length > 0) {
            renderCards(item.cards);
          }
        }
      }
      state.conversationId = previous.conversation_id;
      state.restoreBlocked = false;
      state.conversationInitiator = "prima";
      state.greetingShown = data.messages.length > 0;
      state.greetingText = PRIMA_GREETING_V1;
      state.awaitingName = data.messages.length === 1 &&
        data.messages[0]?.role === "assistant";
      state.firstUserTurnPending = false;
      state.turnSequence = Math.max(0,
        Number(data.last_applied_turn_seq) || 0,
        ...data.messages.map(m => Number(m.turn_seq) || 0)
      );
      // The server's canonical Memory/Conversation State remains authoritative.
      // RESTORE-02A replays stored project cards only. SearchContext and
      // pagination remain unavailable until the separate restore step.
      state.searchContext = null;
      state.searchPagination = null;
      state.pendingSearchContext = null;
      state.lastSearchQuery = "";
      if (data.messages.length === 0) {
        await renderConversationGreeting(PRIMA_GREETING_V1);
      }
      scrollToBottom(false);
      // Also attach older RESTORE-01 sessions when opened after this update.
      void attachPrimaReturnSessionV1(previous.conversation_id,previous.token);
      return "restored";
    } catch (error) {
      if (error?.message === "conversation_access_denied" ||
          error?.message === "conversation_not_found") {
        clearPrimaResumeCapabilityV1();
        state.conversationId = null;
        state.conversationAccessToken = null;
        state.restoreBlocked = false;
        return "new";
      }
      console.warn("Prima restore unavailable; no new conversation created", error?.message);
      dynamic.innerHTML = "";
      const assistant = createAssistantTurn(false);
      assistant.message.textContent =
        "Your previous conversation could not be restored right now. " +
        "Please refresh to retry. No new conversation was created.";
      state.conversationId = null;
      state.conversationAccessToken = null;
      state.restoreBlocked = true;
      return "retry";
    } finally {
      setBusy(false);
    }
  }

  function getPrimadomAnalyticsContext() {
    const context =
      window
        .__primadomAnalyticsContextV1;

    if (
      !context ||
      typeof context !== "object"
    ) {
      return {
        visitor_id: null,
        session_id: null,
        pageview_id: null
      };
    }

    return {
      visitor_id:
        context.visitor_id ||
        null,

      session_id:
        context.session_id ||
        null,

      pageview_id:
        context.pageview_id ||
        null
    };
  }


  async function renderConversationGreeting(
    text
  ) {
    if (
      !text ||
      state.greetingShown
    ) {
      return;
    }

    const assistant =
      createAssistantTurn(
        false
      );

    state.greetingShown =
      true;

    state.awaitingName =
      true;

    await revealText(
      assistant.message,
      text
    );

    scrollToBottom();
  }


  async function ensureConversation({
    initiator = "user"
  } = {}) {
    if (state.restoreBlocked) {
      throw new Error("conversation_restore_retry_required");
    }
    if (
      state.conversationId
    ) {
      return (
        state.conversationId
      );
    }

    if (
      !state.conversationStartPromise
    ) {
      const analyticsContext =
        getPrimadomAnalyticsContext();

      const started =
        performance.now();

      state.conversationStartPromise =
        postJson(
          "/api/prima/conversation/start",
          {
            visitor_id:
              analyticsContext
                .visitor_id,

            session_id:
              analyticsContext
                .session_id,

            initiator,

            ...CONTEXT
          }
        )
          .then(data => {
            const conversationId =
              data
                ?.conversation
                ?.conversation_id ||
              null;

            if (!conversationId) {
              throw new Error(
                "conversation_id_missing"
              );
            }

            // The capability token stays in this tab's memory only.
            // A page refresh initiates a new conversation rather than reusing
            // a bare conversation ID without proof of access.
            if (typeof data?.conversation_access_token !== "string" ||
                data.conversation_access_token.length !== 43) {
              throw new Error("conversation_access_token_missing");
            }
            state.conversationAccessToken = data.conversation_access_token;
            state.conversationId =
              conversationId;
            storePrimaResumeCapabilityV1(
              conversationId,
              state.conversationAccessToken
            );
            void attachPrimaReturnSessionV1(
              conversationId, state.conversationAccessToken
            );

            state.conversationInitiator =
              data?.initiator ||
              initiator;

            state.greetingText =
              data?.greeting ||
              state.greetingText;

            state.firstUserTurnPending =
              state
                .conversationInitiator ===
                "user";

            console.log(
              "Prima conversation started:",
              {
                conversation_id:
                  conversationId,

                initiator:
                  state
                    .conversationInitiator,

                latency_ms:
                  Math.round(
                    performance.now() -
                    started
                  ),

                used_openai:
                  data?.meta
                    ?.used_openai ??
                  false,

                input_tokens:
                  data?.meta
                    ?.input_tokens ??
                  0,

                output_tokens:
                  data?.meta
                    ?.output_tokens ??
                  0,

                total_openai_tokens:
                  data?.meta
                    ?.total_openai_tokens ??
                  0,

                visitor_id:
                  analyticsContext
                    .visitor_id,

                session_id:
                  analyticsContext
                    .session_id
              }
            );

            return conversationId;
          })
          .finally(() => {
            state.conversationStartPromise =
              null;
          });
    }

    return await state
      .conversationStartPromise;
  }


  async function startPrimaConversation() {
    if (state.restoreBlocked) return;
    /*
      Greeting is deterministic and rendered immediately.
      Server conversation creation/persistence runs in parallel.
      No OpenAI is used for this greeting.
    */
    if (
      !state.greetingShown
    ) {
      state.greetingText =
        PRIMA_GREETING_V1;

      renderConversationGreeting(
        PRIMA_GREETING_V1
      );
    }

    try {
      await ensureConversation({
        initiator: "prima"
      });
    } catch (error) {
      console.error(
        "Prima conversation start failed:",
        error
      );
    }
  }


function createUserTurn(
  text
) {
  const turn =
    document.createElement(
      "div"
    );

  turn.className =
    "turn user-turn";

  const bubble =
    document.createElement(
      "div"
    );

  bubble.className =
    "user-bubble";

  bubble.textContent =
    text;

  turn.appendChild(
    bubble
  );

  dynamic.appendChild(
    turn
  );

  return turn;
}


function createAssistantTurn(
  loading = false
) {
  const turn =
    document.createElement(
      "div"
    );

  turn.className =
    "turn";

  const avatar =
    document.createElement(
      "div"
    );

  avatar.className =
    "avatar";

  if (avatarSrc) {
    const img =
      document.createElement(
        "img"
      );

    img.src =
      avatarSrc;

    img.alt =
      "Prima AI mark";

    avatar.appendChild(
      img
    );
  }

  const message =
    document.createElement(
      "div"
    );

  message.className =
    "message";

  message.style.whiteSpace =
    "pre-wrap";

  if (loading) {
    message.textContent =
      "Prima is thinking…";

    message.style.color =
      "rgba(255,255,255,.42)";
  }

  turn.append(
    avatar,
    message
  );

  dynamic.appendChild(
    turn
  );

  return {
    turn,
    message
  };
}


/*
  Soft GPT-like reveal.

  Worker still returns the completed answer.
  This only prevents the answer from appearing
  as one abrupt block.

  We can tune this visually later.
*/
async function revealText(
  element,
  text
) {
  const value =
    String(
      text || ""
    );

  element.textContent =
    "";

  element.style.color =
    "";

  const parts =
    value.match(
      /\S+\s*/g
    ) || [];

  if (!parts.length) {
    return;
  }

  let index = 0;

  while (
    index < parts.length
  ) {
    /*
      GPT-like visual cadence:
      small flowing chunks, not character typing
      and not an instant full-block reveal.
    */
    const remaining =
      parts.length - index;

    const chunkSize =
        remaining > 50
          ? 3
          : remaining > 24
            ? 2
            : 1;

    const chunk =
      parts
        .slice(
          index,
          index + chunkSize
        )
        .join("");

    element.textContent +=
      chunk;

    index +=
      chunkSize;

    scrollToBottom(
      false
    );

    const trimmed =
      chunk.trim();

    let delay = 52;

      if (
        /[.!?]["']?$/.test(
          trimmed
        )
      ) {
        delay = 125;
      } else if (
        /[,;:]$/.test(
          trimmed
        )
      ) {
        delay = 78;
      }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          delay
        )
    );
  }
}

function renderInlineBold(
  element
) {
  if (!element) {
    return;
  }

  const value =
    String(
      element.textContent || ""
    );

  if (!value.includes("**")) {
    return;
  }

  const pattern =
    /\*\*([\s\S]+?)\*\*/g;

  const fragment =
    document.createDocumentFragment();

  let lastIndex = 0;
  let matched = false;
  let match;

  while (
    (
      match =
        pattern.exec(value)
    ) !== null
  ) {
    matched = true;

    if (match.index > lastIndex) {
      fragment.appendChild(
        document.createTextNode(
          value.slice(
            lastIndex,
            match.index
          )
        )
      );
    }

    const strong =
      document.createElement(
        "strong"
      );

    strong.textContent =
      match[1];

    fragment.appendChild(
      strong
    );

    lastIndex =
      pattern.lastIndex;
  }

  if (!matched) {
    return;
  }

  if (lastIndex < value.length) {
    fragment.appendChild(
      document.createTextNode(
        value.slice(lastIndex)
      )
    );
  }

  element.replaceChildren(
    fragment
  );
}


function addFollowUp(
  messageElement,
  followUp
) {
  if (!followUp) {
    return;
  }

  const p =
    document.createElement(
      "p"
    );

  p.textContent =
    followUp;

  p.style.marginTop =
    "12px";

  messageElement.appendChild(
    p
  );
}


function titleFromSlug(
  slug = ""
) {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map(
      part =>
        part.charAt(0)
          .toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}



// G V1.1 UX: one optional introduction card per verified project
// within the same conversation. Search cards and canonical refs are untouched.
const shownProjectIntroCards = new Map();

async function renderConfirmedProjectCard(data, userMessage = "") {
  if (Array.isArray(data?.cards) && data.cards.length) return;

  const ref = data?.single_project_ref;

  if (
    ref?.entity_type !== "project" ||
    !ref.slug ||
    !ref.canonical_url?.startsWith("/en/projects/")
  ) return;

  const conversationKey = String(data?.conversation_id || state.conversationId || "");
  const alreadyIntroduced = shownProjectIntroCards.get(conversationKey)?.has(ref.slug) === true;
  const explicitVisualRequest =
    /\b(?:show|display|see|view|open)\b[\s\S]{0,60}\b(?:image|photo|picture|card|rendering|visual)\b/i.test(userMessage);
  // G19/G20: one introduction card per conversation, not per route.
  // Canonical single_project_ref stays in the response for dialogue state;
  // it is not a reason to repeat imagery during advisory/recommendation.
  const introductionRoute = ["page_question", "recommendation", "exact_fact", "follow_up"].includes(data?.route);
  if (introductionRoute && conversationKey &&
      alreadyIntroduced && !explicitVisualRequest) return;

  const exact = item =>
    item?.entity_type === "project" &&
    item.slug === ref.slug &&
    item.canonical_url === ref.canonical_url;

  let project = state.searchContext?.results?.find(exact);

  if (!project) {
    try {
      const result = await runPrimaProjectSearchBridge({
        version: "PrimaToolRequestV1",
        tool: "prima_search",
        action: "search_projects",
        language: "en",
        entity_type: "project",
        query: ref.slug.replace(/-/g, " ")
      });

      project = result?.results?.find(exact);
    } catch (error) {
      console.warn("Prima single card lookup:", error);
    }
  }

  if (!project) return;

  renderCards([{
    version: "EntityCardRefV1",
    entity_type: "project",
    slug: project.slug,
    canonical_url: project.canonical_url,
    gallery_1: project.gallery_1 || "",
    image_alt: project.image_alt || "",
    rank: 1,
    facts: {
      version: "ProjectCardFactsV1",
      title: project.title || "",
      price_display: project.price_display || "",
      district: project.district || "",
      developer: project.developer || ""
    }
  }]);

  if (introductionRoute && conversationKey) {
    if (!shownProjectIntroCards.has(conversationKey)) {
      shownProjectIntroCards.set(conversationKey, new Set());
    }
    shownProjectIntroCards.get(conversationKey).add(ref.slug);
    // Bound client memory to the currently active conversation only.
    for (const key of shownProjectIntroCards.keys()) {
      if (key !== conversationKey) shownProjectIntroCards.delete(key);
    }
  }
}

function renderCards(
  cards = []
) {
  if (
    !Array.isArray(cards) ||
    cards.length === 0
  ) {
    return;
  }

  const wrap =
    document.createElement(
      "div"
    );

  wrap.className =
    "cards";

  for (
    const card of
      cards.slice(0, 3)
  ) {
    const facts =
      card?.facts || {};

    const slug =
      String(
        card?.slug || ""
      );

    const title =
      facts.title ||
      titleFromSlug(
        slug
      ) ||
      "Project";

    const rawCanonicalUrl =
      String(
        card?.canonical_url || ""
      ).trim();

    const projectUrl =
      rawCanonicalUrl
        ? new URL(
            rawCanonicalUrl,
            "https://primadom.ai"
          ).href
        : slug
          ? `https://primadom.ai/en/projects/${encodeURIComponent(slug)}/`
          : "";

    const openProjectPage =
      () => {
        if (!projectUrl) {
          return;
        }

        window.open(
          projectUrl,
          "_blank",
          "noopener"
        );
      };


    const project =
      document.createElement(
        "article"
      );

    project.className =
      "card";

    if (projectUrl) {
      project.style.cursor =
        "pointer";

      project.setAttribute(
        "role",
        "link"
      );

      project.tabIndex = 0;

      project.addEventListener(
        "click",
        event => {
          if (
            event.target.closest(
              "button"
            )
          ) {
            return;
          }

          openProjectPage();
        }
      );

      project.addEventListener(
        "keydown",
        event => {
          if (
            event.target.closest(
              "button"
            )
          ) {
            return;
          }

          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            openProjectPage();
          }
        }
      );
    }

    /*
      Real Card Resolver / promo_image comes next.
      For this first live UI pass we deliberately
      do not invent an image.
    */
    const media =
      document.createElement(
        "div"
      );

    media.className =
      "media";

    media.style.background =
      "rgba(255,255,255,.035)";

    const imageUrl =
      String(
        card?.gallery_1 || ""
      ).trim();

    if (imageUrl) {
      const image =
        document.createElement(
          "img"
        );

      image.src =
        imageUrl;

      image.alt =
        String(
          card?.image_alt ||
          title ||
          ""
        );

      image.loading =
        "lazy";

      media.appendChild(
        image
      );
    }

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "card-body";

    if (
      facts.price_display
    ) {
      const price =
        document.createElement(
          "div"
        );

      price.className =
        "price";

      price.textContent =
        `From ${facts.price_display}`;

      media.appendChild(
        price
      );
    }

    const heading =
      document.createElement(
        "h3"
      );

    heading.textContent =
      title;

    body.appendChild(
      heading
    );

    const subtitle =
      [
        facts.district,
        facts.developer
      ]
        .filter(Boolean)
        .join(" · ");

    if (subtitle) {
      const line =
        document.createElement(
          "p"
        );

      line.textContent =
        subtitle;

      body.appendChild(
        line
      );
    }

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "actions";

    const discuss =
      document.createElement(
        "button"
      );

    discuss.className =
      "primary";

    discuss.type =
      "button";

    discuss.textContent =
      "Discuss";

    discuss.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        if (card?.single_detail === true) {
          input.focus();
          return;
        }

        input.value =
          `Tell me more about ${title}`;

        send();
      }
    );

    actions.appendChild(
      discuss
    );

    if (projectUrl) {
      const open =
        document.createElement(
          "button"
        );

      open.type =
        "button";

      open.textContent =
        "Open page";

      open.addEventListener(
        "click",
        event => {
          event.stopPropagation();
          openProjectPage();
        }
      );

      actions.appendChild(
        open
      );
    }

    body.appendChild(
      actions
    );

    project.append(
      media,
      body
    );

    wrap.appendChild(
      project
    );
  }

  dynamic.appendChild(
    wrap
  );

  scrollToBottom();
}


function renderSearchQuickActions(
  data
) {
  const pagination =
    data?.search_pagination;

  // PRIMA_SEARCH_ACTIONS_PERSIST_P2_V1
  // A confirmed entity follow-up is not a new search. Keep the last
  // verified SearchPaginationV1 action and its bound offset alive.
  // Only an actual new search page replaces the actions; this avoids
  // disabling Show 3 more when discussing its first/second result.
  if (
    pagination?.version !== "SearchPaginationV1" &&
    state.searchContext?.version === "SearchContextV1" &&
    ["follow_up", "exact_fact", "page_question"].includes(data?.route)
  ) {
    return;
  }

  for (
    const existing of
      dynamic.querySelectorAll(
        ".quick[data-prima-search-actions]"
      )
  ) {
    existing.remove();
  }

  if (
    pagination?.version !==
      "SearchPaginationV1"
  ) {
    return;
  }

  const quick =
    document.createElement(
      "div"
    );

  quick.className =
    "quick";

  quick.dataset.primaSearchActions =
    "1";


  if (
    pagination.has_more === true &&
    Number.isInteger(
      pagination.next_offset
    ) &&
    state.searchContext
  ) {
    const more =
      document.createElement(
        "button"
      );

    more.type =
      "button";

    more.textContent =
      "Show 3 more";

    more.addEventListener(
      "click",
      () => {
        if (state.busy) {
          return;
        }

        const nextContext = {
          ...state.searchContext,

          current_batch_offset:
            pagination.next_offset
        };

        state.pendingSearchContext =
          nextContext;

        input.value =
          "Show 3 more";

        send();
      }
    );

    quick.appendChild(
      more
    );
  }


  const refine =
    document.createElement(
      "button"
    );

  refine.type =
    "button";

  refine.textContent =
    "Refine search";

  refine.addEventListener(
    "click",
    () => {
      if (state.busy) {
        return;
      }

      input.value =
        state.lastSearchQuery ||
        "";

      input.focus();

      if (
        typeof input.setSelectionRange ===
          "function"
      ) {
        const end =
          input.value.length;

        input.setSelectionRange(
          end,
          end
        );
      }
    }
  );

  quick.appendChild(
    refine
  );


  const advisor =
    document.createElement(
      "button"
    );

  advisor.type =
    "button";

  advisor.textContent =
    "Ask an advisor";

  advisor.addEventListener(
    "click",
    () => {
      if (state.busy) {
        return;
      }

      input.value =
        "I'd like to speak with an advisor";

      send();
    }
  );

  quick.appendChild(
    advisor
  );


  dynamic.appendChild(
    quick
  );

  scrollToBottom();
}


// D6_RETURN_PREVIOUS_SEARCH_V1
// Recognizes an explicit return to the active search session.
// C_D_CLARIFICATION_RESUME_NAMED_SCOPE_V11:
// An explicit return may refer to a verified search by its named
// developer and district ("the Aldar projects in Saadiyat"), not only
// by demonstratives ("those projects"). Check BOTH names against the
// live D5 session. Never resume another named search by accident.
function d6ReturnPreviousSearchIntentV1(message = "", searchContext = null) {
  const q = String(message || "").trim();
  // C_D_RESUME_VERIFIED_D5_V10: only a navigation request concerning
  // the previous search. Never treat a new comparison/search as "resume".
  if (/^(?:show me more options from my previous search|show more options from my previous search|show (?:me )?(?:the )?next (?:3|three) (?:projects|options) from my previous search|(?:go )?back to (?:my |the )?(?:previous |last )?search(?: results)?|return to (?:my |the )?(?:previous |last )?search(?: results)?)\s*[.!?]*$/i.test(q)) return true;
  const returnCue = /\b(?:go back to|back to|return to|resume)\b/i.test(q);
  const moreCue = /\b(?:show(?: me)? (?:the )?next (?:3|three)|show(?: me)? more|continue)\b/i.test(q);
  const rejected = /\b(?:instead|another|different|new search|compare|versus)\b/i.test(q);
  if (!returnCue || !moreCue || rejected) return false;
  const traditional = /\b(?:those|these|previous|earlier|last)\b/i.test(q) &&
    /\b(?:projects?|properties|results|search|options)\b/i.test(q);
  // The named variant is admitted ONLY when the saved search itself
  // confirms the two referents. Generic D3 fallback must never replace
  // an unresolved "resume" with hundreds of unrelated projects.
  const named = /\b(?:go back to|back to|return to)\s+(?:the|my|those|these)\s+(.+?)\s+projects?\s+in\s+(.+?)(?=\s*[.!?;]|$)/i.exec(q);
  if (!named) return traditional;
  if (searchContext?.version !== "SearchContextV1" ||
      searchContext?.entity_type !== "project" ||
      searchContext?.state !== "results" ||
      !searchContext?.filters?.developer ||
      !searchContext?.filters?.district) return false;
  const norm = v => String(v || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const developer = norm(named[1]);
  const district = norm(named[2]);
  const savedDeveloper = norm(searchContext.filters.developer);
  const savedDistrict = norm(searchContext.filters.district);
  const matchingPrefix = (saved, proposed) => proposed.length >= 4 &&
    (saved === proposed || saved.startsWith(proposed + " "));
  return matchingPrefix(savedDeveloper, developer) &&
    matchingPrefix(savedDistrict, district);
}

function shouldCarrySearchContext(
  message = ""
) {
  return d6ReturnPreviousSearchIntentV1(message, state.searchContext) || /\b(this one|that one|(?:the\s+)?(?:first|second|third|1st|2nd|3rd)\s+(?:one|project|option)|those|these|what about|how about|and this|and that|which one|why this|why that|same for)\b/i
    .test(
      String(
        message || ""
      )
    );
}



// D4 local preview only. Existing Project Search is unchanged.
async function fetchD4DeveloperBatch(query, offset = 0) {
  if (state.d4FacetedMatches?.query === query) {
    const url = new URL("/__prima_d4_developers", API_BASE);
    const response = await fetch(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state.d4FacetedMatches, offset })
    });
    if (!response.ok) throw new Error("Developer grouping failed: " + response.status);
    const result = await response.json();
    if (result?.version !== "DeveloperProjectGroupsV1" ||
        !Array.isArray(result.results)) {
      throw new Error("Invalid grouped developer result");
    }
    return result;
  }
  const url = new URL("/__prima_d4_developers", API_BASE);
  url.searchParams.set("q", String(query || ""));
  url.searchParams.set("offset", String(offset));

  const response = await fetch(url.href);

  if (!response.ok) {
    throw new Error("Developer Registry request failed: " + response.status);
  }

  const result = await response.json();

  if (
    !["DeveloperDiscoveryV1", "DeveloperProjectGroupsV1"].includes(result?.version) ||
    !Array.isArray(result.results)
  ) {
    throw new Error("Invalid DeveloperDiscoveryV1 response");
  }

  return result;
}



// D6_PROJECT_TO_VERIFIED_DEVELOPER_CARD_V1
// UI integration only. Project Catalog + D4 Registry are sources of truth.


/*
  E04_TEXT_ONLY_EXACT_FACT_V13

  A verified, text-only exact_fact response may retain a canonical
  single_project_ref for ConversationState. A reference is not a UI
  instruction to repeat its card. Respect an empty cards array.

  Do not change response payload, knowledge facts, D4 developer cards,
  ordinal cards, or the intentional page_question/project introduction.
*/
function primaE04TextOnlyExactFactV1(response) {
  if (
    response?.route !== "exact_fact" ||
    response?.response_type !== "answer" ||
    typeof response?.answer !== "string" ||
    !response.answer.trim() ||
    !Array.isArray(response?.cards) ||
    response.cards.length !== 0
  ) return false;

  const ref = response.single_project_ref;
  return (
    ref?.entity_type === "project" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(ref.slug || "")) &&
    String(ref.canonical_url || "") === `/en/projects/${ref.slug}/`
  );
}

/*
  E1_7_SKIP_REDUNDANT_PROJECT_CARD_V1

  A verified project-to-developer fact question
  needs the developer card, not a second project card.

  Only skip project-card rendering for this narrow
  case. The D4 developer-card verification remains
  completely unchanged.
*/
function primaE17SkipProjectCardV1(message, response) {
  const question =
    String(message || "").trim();

  // E1 developer fact: grammar is resolved in one helper only.
  // A verified developer card replaces the redundant project card.
  const target = primaDeveloperQuestionTargetV1(question);
  if (
    !/^(?:that one|this one|it|that project|this project)$/i
      .test(String(target || ""))
  ) {
    return false;
  }

  if (
    !response ||
    response.response_type !== "answer" ||
    typeof response.answer !== "string" ||
    !/^\s*.+?\s+is\s+developed\s+by\s+.+/i
      .test(response.answer)
  ) {
    return false;
  }

  const ref = response.single_project_ref;

  if (
    ref?.entity_type !== "project" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      String(ref.slug || "")
    ) ||
    String(ref.canonical_url || "") !==
      `/en/projects/${ref.slug}/`
  ) {
    return false;
  }

  return true;
}

function primaDeveloperQuestionTargetV1(value) {
  const question = String(value || "").trim();

  // Natural possessive follow-up: "Who is its developer?"
  // This reuses the existing verified project -> D4 developer pipeline.
  if (/^who\s+(?:is|was)\s+its\s+developer\s*[?.!]*$/i.test(question)) {
    return "it";
  }

  const match = question.match(
    /^who\s+(?:is|was)\s+(?:the\s+)?developer\s+(?:of|for)\s+(.+?)\s*[?.!]*$/i
  );

  return String(match?.[1] || "").trim() || null;
}

function primaDeveloperIdentityNormalizeV1(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function primaDeveloperAnswerConfirmsV1(answer, developer) {
  const text = " " +
    primaDeveloperIdentityNormalizeV1(answer) + " ";

  const full = primaDeveloperIdentityNormalizeV1(developer);
  if (!full) return false;

  const withoutCompanySuffix = full.replace(
    /\s+(?:pjsc|llc|ltd|limited|plc|inc)$/,
    ""
  );

  const candidates = [full];

  if (withoutCompanySuffix !== full &&
      withoutCompanySuffix.length >= 5) {
    candidates.push(withoutCompanySuffix);
  }

  return candidates.some(name =>
    text.includes(" " + name + " ")
  );
}

async function primaRenderVerifiedProjectDeveloperV1(
  userMessage,
  response,
  assistantMessage
) {
  // An ordinary completed answer is required.
  if (
    !response ||
    isToolRequest(response) ||
    response.route === "off_topic" ||
    response.response_type === "clarification" ||
    typeof response.answer !== "string" ||
    /couldn't reach|could not reach|couldn't match|could not match/i
      .test(response.answer)
  ) return false;

  /*
    E1_REFERENCED_DEVELOPER_CARD_V1

    For contextual developer questions, use the
    Worker-confirmed project reference and the
    completed factual answer.

    Keep every existing D6 verification:
    Project Catalog identity, answer confirmation,
    D4 Registry identity and canonical URLs.
  */
  const explicitProject =
    primaDeveloperQuestionTargetV1(userMessage);

  const isReferencedProjectQuestion =
    /^(?:that one|this one|it|that project|this project)$/i
      .test(String(explicitProject || "").trim());

  const projectRef =
    response?.single_project_ref;

  const verifiedProjectReference =
    isReferencedProjectQuestion &&
    projectRef?.entity_type === "project" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      String(projectRef.slug || "")
    ) &&
    String(projectRef.canonical_url || "") ===
      `/en/projects/${projectRef.slug}/`
      ? projectRef
      : null;

  const referencedProjectName =
    verifiedProjectReference
      ? String(response.answer || "").match(
          /^\s*(.+?)\s+is\s+developed\s+by\s+(.+?)\s*[.!?]?\s*$/i
        )?.[1]?.trim() || null
      : null;

  const requestedProject =
    isReferencedProjectQuestion
      ? referencedProjectName
      : explicitProject;

  if (!requestedProject) return false;

  try {
    /*
      E1_6_DEVELOPER_CARD_PARALLEL_PREFETCH_V1

      For a verified contextual project reference,
      start the D4 lookup while Project Catalog
      validation is running.

      The answer supplies only a candidate name.
      It never authorizes rendering a card.

      Existing Catalog, answer and D4 identity
      checks remain authoritative.
    */
    const e16StartMs = performance.now();

    const e16CandidateMatch =
      verifiedProjectReference
        ? String(response.answer || "").match(
            /^\s*.+?\s+is\s+developed\s+by\s+(.+?)\s*[.!?]?\s*$/i
          )
        : null;

    const e16CandidateName =
      String(e16CandidateMatch?.[1] || "").trim();

    const e16PrefetchedD4 =
      e16CandidateName &&
      e16CandidateName.length <= 120
        ? fetchD4DeveloperBatch(
            "Find " + e16CandidateName,
            0
          ).catch(() => null)
        : null;

    // The actual Project Catalog remains authoritative.
    const project =
      await primaResolveCatalogProjectV1(requestedProject);

    const e16CatalogReadyMs = performance.now();

    if (
      !project ||
      !project.slug ||
      !/^\/en\/projects\/[a-z0-9-]+\/$/.test(
        String(project.canonical_url || "")
      ) ||
      primaDeveloperIdentityNormalizeV1(project.title) !==
        primaDeveloperIdentityNormalizeV1(requestedProject)
    ) {
      return false;
    }

    // E1.5 — resolved project must match the actual catalog record.
    if (
      verifiedProjectReference &&
      (
        String(project.slug) !==
          verifiedProjectReference.slug ||
        String(project.canonical_url) !==
          verifiedProjectReference.canonical_url
      )
    ) {
      return false;
    }

    const developerName = String(
      project.developer || ""
    ).trim();

    // The answer must confirm the developer already present
    // in the verified project catalog.
    if (
      !developerName ||
      !primaDeveloperAnswerConfirmsV1(
        response.answer,
        developerName
      )
    ) {
      return false;
    }

    // Existing Developer Registry, not an invented company.
    const e16CanUsePrefetch =
      Boolean(e16PrefetchedD4) &&
      primaDeveloperIdentityNormalizeV1(
        e16CandidateName
      ) ===
      primaDeveloperIdentityNormalizeV1(
        developerName
      );

    const batch =
      e16CanUsePrefetch
        ? (
            (await e16PrefetchedD4) ||
            await fetchD4DeveloperBatch(
              "Find " + developerName,
              0
            )
          )
        : await fetchD4DeveloperBatch(
            "Find " + developerName,
            0
          );

    const e16D4ReadyMs = performance.now();

    if (
      batch?.version !== "DeveloperDiscoveryV1" ||
      Number(batch.result_count) !== 1 ||
      !Array.isArray(batch.results) ||
      batch.results.length !== 1
    ) {
      return false;
    }

    const developer = batch.results[0];

    if (
      !/^\/en\/developers\/[a-z0-9-]+\/$/.test(
        String(developer.canonical_url || "")
      ) ||
      !developer.slug
    ) {
      return false;
    }

    const actualName =
      primaDeveloperIdentityNormalizeV1(developer.title);

    const expectedName =
      primaDeveloperIdentityNormalizeV1(developerName);

    // Allow a canonical company suffix, not unrelated matches.
    const identityMatch =
      actualName === expectedName ||
      actualName.replace(
        /\s+(?:pjsc|llc|ltd|limited|plc|inc)$/,
        ""
      ) === expectedName ||
      expectedName.replace(
        /\s+(?:pjsc|llc|ltd|limited|plc|inc)$/,
        ""
      ) === actualName;

    if (!identityMatch) return false;

    // Reuse the finished D4 card renderer, including
    // canonical link, Discuss and Projects actions.
    await renderD4DeveloperCards(
      batch,
      "Find " + developer.title,
      assistantMessage
    );

    console.info(
      "e1_6_verified_developer_card_timing",
      {
        project: project.slug,
        developer: developer.title,
        parallel_prefetch: e16CanUsePrefetch,
        catalog_ms: Math.round(
          e16CatalogReadyMs - e16StartMs
        ),
        d4_ready_ms: Math.round(
          e16D4ReadyMs - e16StartMs
        ),
        total_card_lookup_ms: Math.round(
          performance.now() - e16StartMs
        )
      }
    );

    console.info(
      "d6_verified_project_developer_card",
      {
        project: project.slug,
        developer: developer.title,
        canonical_url: developer.canonical_url
      }
    );

    return true;
  } catch (error) {
    // A card lookup must never break a successful text answer.
    console.warn(
      "d6_developer_card_optional_lookup_unavailable",
      error
    );
    return false;
  }
}


/*
  E23_MULTI_ENTITY_ACTIVE_BATCH_V1

  D4 developers and D5 districts:
  - preserve the first and subsequent batches
  - point ordinals at the most recently displayed batch
  - retain canonical Registry identities

  D3/project SearchContext is never replaced by this
  helper unless a new developer/district listing is shown.
*/
function primaE23SetActiveBatch(batch, entityType, query) {
  if (!["developer", "district"].includes(entityType)) {
    return false;
  }

  const raw = Array.isArray(batch?.results)
    ? batch.results.slice(0, 3)
    : [];

  const offset = Number(batch?.current_batch_offset);
  const pathname = entityType === "developer"
    ? "/en/developers/"
    : "/en/areas/";

  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    raw.length === 0 ||
    raw.some(row =>
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        String(row?.slug || "")
      ) ||
      String(row?.canonical_url || "") !==
        pathname + row.slug + "/"
    )
  ) {
    return false;
  }

  const key = String(query || "").trim();

  const current = state.searchContext;
  const sameSession =
    current?.version === "SearchContextV1" &&
    current?.entity_type === entityType &&
    current?.e23_query_key === key &&
    Array.isArray(current.results);

  if (
    offset > 0 &&
    (
      !sameSession ||
      current.results.length !== offset
    )
  ) {
    console.warn(
      "e23_batch_continuity_guard",
      {entityType, offset}
    );
    return false;
  }

  const results =
    offset === 0
      ? []
      : current.results.slice();

  raw.forEach((row, i) => {
    results[offset + i] = {
      entity_type: entityType,
      slug: row.slug,
      title: String(row.title || row.slug),
      canonical_url: row.canonical_url
    };
  });

  state.searchContext = {
    version: "SearchContextV1",
    language: "en",
    source: "prima_ui_verified_entity_batch_v1",
    entity_type: entityType,
    state: "results",
    query: key,
    e23_query_key: key,
    current_batch_offset: offset,
    result_count:
      Number(batch?.result_count) || results.length,
    results
  };

  console.info(
    "e23_active_entity_batch",
    {
      entity_type: entityType,
      active_offset: offset,
      accumulated: results.length,
      active_titles: raw.map(row => row.title)
    }
  );

  return true;
}



/*
  E34_CONTEXTUAL_DEVELOPER_ACTIONS_V1

  Contextual actions after a developer-area answer.
  Identity comes from verified ConversationStateV1.
  No new cards, no new Registry requests and no
  modification of existing D4 pagination controls.
*/
function primaE34ContextDeveloperActionSpecV1(
  message,
  response
) {
  const question =
    String(message || "").trim();

  const isDeveloperAreaQuestion =
    /^where\s+does\s+(?:it|this developer|that developer)\s+(?:(?:mainly|mostly|typically)\s+)?(?:develop|build)(?:\s+projects)?\s*[?.!]*(?:\s+copy)?$/i
      .test(question);

  if (
    !isDeveloperAreaQuestion ||
    response?.version !== "ResponseContractV1" ||
    response?.response_type !== "answer"
  ) {
    return null;
  }

  const entity =
    response?.meta?.conversation_state
      ?.continuity_references?.current_entity;

  const type = String(entity?.type || "");
  const slug = String(entity?.slug || "");

  if (
    type !== "developer" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return null;
  }

  const results =
    Array.isArray(state.searchContext?.results)
      ? state.searchContext.results
      : [];

  const matched = results.find(
    item =>
      item?.entity_type === "developer" &&
      item?.slug === slug &&
      item?.canonical_url ===
        "/en/developers/" + slug + "/"
  );

  const fallbackName =
    slug.split("-").map(
      word => word.charAt(0).toUpperCase() +
        word.slice(1)
    ).join(" ");

  const name = String(
    matched?.title ||
    entity?.name ||
    fallbackName
  ).trim();

  if (!name) return null;

  return {
    type: "developer",
    slug,
    name,
    shortName: name.split(/\s+/)[0],
    projectQuery: `Show me ${name} projects`,
    advisorQuery:
      `I'd like to speak with an advisor about ${name}`
  };
}

function primaE34RenderContextActionsV1(
  message,
  response
) {
  const spec =
    primaE34ContextDeveloperActionSpecV1(
      message,
      response
    );

  if (!spec) return false;

  const toolbar = document.createElement("div");

  toolbar.className =
    "quick prima-developer-actions prima-e34-developer-actions";

  // Deliberately NOT data-prima-developer-actions:
  // D4 pagination cleanup must never remove these
  // conversation-specific actions.
  toolbar.dataset.primaE34ContextActions = "1";
  toolbar.dataset.developerSlug = spec.slug;

  function addAction(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    toolbar.appendChild(button);
  }

  addAction(spec.shortName + " projects", () => {
    if (state.busy) return;
    input.value = spec.projectQuery;
    send();
  });

  addAction("Refine search", () => {
    if (state.busy) return;

    input.value = spec.projectQuery;
    input.focus();
    input.setSelectionRange?.(
      input.value.length,
      input.value.length
    );
  });

  addAction("Ask an advisor", () => {
    if (state.busy) return;
    input.value = spec.advisorQuery;
    send();
  });

  dynamic.appendChild(toolbar);
  scrollToBottom();

  console.info(
    "e34_contextual_developer_actions",
    {
      developer: spec.name,
      slug: spec.slug,
      buttons: 3
    }
  );

  return true;
}

async function primaE23RenderOrdinalCardV1(
  message, response, assistantMessage
) {
  if (
    response?.route !== "follow_up" ||
    response?.response_type !== "answer"
  ) return false;

  const ordinal = String(message || "").match(
    /\b(?:the\s+)?(first|second|third)\s+(?:one|developer|district|area|option)\b/i
  );

  if (!ordinal) return false;

  const index = {
    first: 0, second: 1, third: 2
  }[ordinal[1].toLowerCase()];

  const context = state.searchContext;
  const type = context?.entity_type;

  if (
    !["developer", "district"].includes(type) ||
    !Number.isInteger(context?.current_batch_offset)
  ) return false;

  const row = context.results?.[
    context.current_batch_offset + index
  ];

  if (
    row?.entity_type !== type ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      String(row.slug || "")
    )
  ) return false;

  const path = type === "developer"
    ? "/en/developers/"
    : "/en/areas/";

  if (
    row.canonical_url !== path + row.slug + "/"
  ) return false;

  const expected =
    `The ${ordinal[1].toLowerCase()} ${type} is ${row.title}.`;

  if (
    String(response.answer || "")
      .trim().toLowerCase() !==
    expected.toLowerCase()
  ) return false;

  if (type === "developer") {
    await renderD4DeveloperCards(
      {
        version: "DeveloperDiscoveryV1",
        results: [row],
        result_count: 1,
        current_batch_offset: 0,
        has_more: false
      },
      "Find " + row.title,
      assistantMessage,
      false
    );
  } else {
    await renderD5DistrictCardV1(row);
  }

  console.info(
    "e23_verified_ordinal_card",
    {type, slug: row.slug, title: row.title}
  );

  return true;
}


/*
  E26_PRESERVE_DEVELOPER_PAGINATION_V1

  Selecting a developer must not destroy the
  active developer discovery toolbar.
  Reuse the actual DOM toolbar with its original
  working Show 3 more event handler.
*/
function primaE26ExistingDeveloperPaginationV1(
  batch,
  trackConversationBatch,
  searchContext,
  root
) {
  if (
    trackConversationBatch ||
    Number(batch?.result_count) !== 1 ||
    Number(batch?.current_batch_offset ?? -1) !== 0 ||
    searchContext?.version !== "SearchContextV1" ||
    searchContext?.entity_type !== "developer"
  ) {
    return null;
  }

  const query = String(searchContext.query || "");

  return [...root.querySelectorAll(
    ".quick[data-prima-developer-actions]"
  )].find(toolbar =>
    toolbar.dataset.primaDeveloperQuery === query &&
    [...toolbar.querySelectorAll("button")].some(
      button =>
        String(button.textContent || "").trim() ===
        "Show 3 more"
    )
  ) || null;
}

async function renderD4DeveloperCards(batch, query, sourceMessage = null, trackConversationBatch = false, f213Remaining = null) {
  const results = Array.isArray(batch?.results)
    ? batch.results.slice(0, f213Remaining === null ? 3 : Math.min(3, f213Remaining))
    : [];

  if (!results.length) return;

  if (
    // E25_D4_DISCOVERY_VERSION_COMPAT_V1
    trackConversationBatch &&
    ["DeveloperDiscoveryV1", "DeveloperProjectGroupsV1"].includes(
      batch?.version
    ) &&
    batch?.entity_type === "developer"
  ) {
    primaE23SetActiveBatch(
      batch, "developer", query
    );
  }

  // Reuse the SAME renderer as Project Cards.
  // Canonical developer URLs are provided by Supabase Registry.
  const existing = new Set(
    dynamic.querySelectorAll(".cards")
  );

  renderCards(
    results.map(row => ({
      slug: row.slug,
      canonical_url: row.canonical_url,
      facts: {
        title: row.title || titleFromSlug(row.slug),
        district: "Real estate developer",
        developer: ""
      }
    }))
  );

  const wrap = [...dynamic.querySelectorAll(".cards")]
    .find(node => !existing.has(node));

  if (wrap) {
    wrap.classList.add("prima-developer-cards");

    [...wrap.querySelectorAll(".card")].forEach((card, index) => {
      enablePrimaEntityCardLinkV1(
        card, results[index]?.canonical_url, "developer"
      );
    });

    const isSingle =
      Number(batch.result_count) === 1 &&
      Number(batch.current_batch_offset || 0) === 0;

    if (isSingle) {
      wrap.classList.add("prima-developer-single");

      const developer = results[0];
      const name = String(developer.title || "");
      const slug = String(developer.slug || "");

      const subtitle = wrap.querySelector(".card-body p");
      if (subtitle) {
        subtitle.textContent =
          "Explore projects, communities and developer insights";
      }

      const profile = batch.developer_profile;
      if (profile) {
        if (subtitle) {
          subtitle.textContent = [
            profile.market,
            profile.founded ? "Established " + profile.founded : null
          ].filter(Boolean).join(" · ");
        }

        const body = wrap.querySelector(".card-body");
        const details = document.createElement("p");
        details.className = "prima-developer-details";
        details.textContent = [
          (profile.focus || []).join(" · "),
          (profile.areas || []).length
            ? "Key areas: " + profile.areas.join(", ")
            : ""
        ].filter(Boolean).join(" | ");

        if (body && details.textContent) {
          body.appendChild(details);
        }

      }

      const actions = wrap.querySelector(".card .actions");

      if (actions) {
        const projectsButton = document.createElement("button");
        projectsButton.type = "button";
        projectsButton.textContent = name.split(" ")[0] + " projects";

        projectsButton.addEventListener("click", event => {
          event.stopPropagation();
          if (state.busy) return;

          input.value = "Show me " + name + " projects";
          send();
        });

        actions.appendChild(projectsButton);
      }


    }

    // Neutral media placeholder, not an invented company photo.
    for (const media of wrap.querySelectorAll(".card .media")) {
      media.classList.add("prima-developer-media");
      const label = document.createElement("span");
      label.className = "prima-developer-media-label";
      label.textContent = "DEVELOPER";
      media.appendChild(label);
    }
  }

  const e26ExistingToolbar =
    primaE26ExistingDeveloperPaginationV1(
      batch,
      trackConversationBatch,
      state.searchContext,
      dynamic
    );

  if (!e26ExistingToolbar) {
    for (const old of dynamic.querySelectorAll(
      ".quick[data-prima-developer-actions]"
    )) {
      old.remove();
    }
  }

  const quick = document.createElement("div");
  quick.className = "quick prima-developer-actions";
  quick.dataset.primaDeveloperActions = "1";
  quick.dataset.primaDeveloperQuery = String(query || "");

  function makeAction(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    quick.appendChild(button);
    return button;
  }

  if (batch.has_more === true && (f213Remaining === null || f213Remaining > results.length)) {
    let loading = false;

    const more = makeAction("Show 3 more", async () => {
      if (state.busy || loading) return;

      loading = true;
      more.disabled = true;

      try {
        const nextOffset =
          Number(batch.current_batch_offset || 0) +
          results.length;

        const next = await fetchD4DeveloperBatch(
          query, nextOffset
        );

        quick.remove();
        renderD4DeveloperCards(next, query, null, true,
          f213Remaining === null ? null : f213Remaining - results.length);
      } catch (error) {
        console.error("D4 pagination failed:", error);
        loading = false;
        more.disabled = false;
      }
    });
  }

  makeAction("Refine search", () => {
    if (state.busy) return;
    input.value = String(query || "");
    input.focus();
    input.setSelectionRange?.(
      input.value.length,
      input.value.length
    );
  });

  makeAction("Ask an advisor", () => {
    if (state.busy) return;
    input.value = "I'd like to speak with an advisor";
    send();
  });

  if (Number(batch.result_count) === 1 && f213Remaining === null) {
    const name = String(results[0]?.title || "this developer");
    const shortName = name.split(" ")[0];
    const message = document.createElement("div");
    message.className = "prima-developer-followup";
    const text =
      `Would you like to explore ${shortName} projects, compare ${shortName} with another developer, or learn more about its communities?`;

    if (sourceMessage) {
      const style = getComputedStyle(sourceMessage);
      for (const property of [
        "fontFamily", "fontSize", "fontWeight",
        "lineHeight", "letterSpacing", "color"
      ]) {
        message.style[property] = style[property];
      }
    }

    dynamic.appendChild(message);
    await revealText(message, text);
  }

  // D4_20_PROJECTS_BUTTON — only new developer cards from this batch.
  const d4CardActions = Array.from(dynamic.querySelectorAll(".card .actions"))
    .slice(-results.length);
  results.forEach((developer, index) => {
    if (Number(batch.result_count) === 1) return; // existing single-card portfolio CTA
    const actions = d4CardActions[index];
    const title = String(developer?.title || "").trim();
    if (!actions || !title || actions.querySelector(".prima-developer-projects-action")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = actions.querySelector("button, a")?.className || "";
    button.classList.add("prima-developer-projects-action");
    button.textContent = "Projects";
    button.addEventListener("click", () => {
      if (state.busy) return;
      input.value = `Show me ${title} projects`;
      send();
    });
    actions.appendChild(button);
  });

  // Reposition the existing pagination controls
  // below the selected developer card.
  dynamic.appendChild(e26ExistingToolbar || quick);
  scrollToBottom();
}



// Developer portfolio only. General Project Search is unchanged.
async function tryDeveloperPortfolioV1(request) {
  if (request?.action !== "search_projects") return null;

  const query = String(request.query || "").trim();
  // D4_25_QUICK_CLOSE: strictly named developer portfolio and attached filters.
  const match = query.match(
    /^(?:(?:show me|show|find|list)\s+)?(.+?)\s+projects(?:\s+(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?)?\s*[.!?]?$/i
  );
  const villas = query.match(
    /^(?:(?:show me|show|find|list)\s+)?villas?\s+by\s+(.+?)\s*[.!?]?$/i
  );

  // D6_DEVELOPER_PROJECT_INTENT_ROUTING_V1
  // Natural phrasing goes to the existing verified D4 portfolio.
  const byProjects = query.match(
    /^(?:(?:show me|show|find|list)\s+)?projects?\s+by\s+(.+?)(?:\s+(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?)?\s*[.!?]?$/i
  );

  if (!match && !villas && !byProjects) return null;

  const name = String(match?.[1] || villas?.[1] || byProjects?.[1] || "")
    .replace(/^(?:the|all)\s+/i,"").trim();
  const confirmedDeveloper = await d4CanonicalDeveloperName(name);
  const slug = (confirmedDeveloper || name).toLowerCase()
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");

  if (!slug) return null;

  const url = new URL("/__prima_d4_developers",API_BASE);
  url.searchParams.set("project_developer",slug);
  if (villas) url.searchParams.set("property_type", "villa");
  const budgetAmount = match?.[2] || byProjects?.[2];
  const budgetUnit = match?.[3] || byProjects?.[3];

  if (budgetAmount) {
    const number = Number(budgetAmount.replace(/,/g, ""));
    const unit = String(budgetUnit || "").toLowerCase();
    const scale = ["million", "m"].includes(unit) ? 1000000 :
      ["thousand", "k"].includes(unit) ? 1000 : 1;
    if (!Number.isFinite(number) || number <= 0) return null;
    url.searchParams.set("max_price", String(number * scale));
  }

  const response = await fetch(url.href);

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Developer portfolio unavailable: " + response.status);
  }

  const result = await response.json();

  if (result?.version !== "SearchContextV1" ||
      result?.entity_type !== "project") {
    throw new Error("Invalid Developer Portfolio SearchContext");
  }

  return {...result, query:request.query};
}


// D4_21_REGISTRY_CANONICAL — one canonical name resolver for developer queries.
// Never assume arbitrary text is a developer: verify one unambiguous registry result.
async function d4CanonicalDeveloperName(name) {
  const candidate = String(name || "").trim().replace(/[.!?]+$/, "").trim();
  if (!candidate || candidate.length > 95 || !/^[a-z][a-z0-9&.' -]*$/i.test(candidate)) {
    return null;
  }

  try {
    // This is the existing working D4 intent, not a bare-name discovery search.
    const batch = await fetchD4DeveloperBatch(`Find ${candidate}`, 0);
    if (Number(batch?.result_count) !== 1 ||
        !Array.isArray(batch?.results) || batch.results.length !== 1) {
      return null;
    }
    const title = String(batch.results[0]?.title || "").trim();
    const normalize = v => String(v || "").toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ").trim();
    const wanted = normalize(candidate);
    const found = normalize(title);
    if (!wanted || !found) return null;
    // Permits Emaar -> Emaar Properties, Aldar -> Aldar Properties PJSC.
    return (found === wanted || found.startsWith(wanted + " ")) ? title : null;
  } catch (error) {
    console.warn("D4 verified developer lookup failed:", error);
    return null;
  }
}

async function d4ResolveBareDeveloperIntent(message) {
  const original = String(message || "").trim();
  if (!original || original.length > 130) return original;
  // Leave project, comparison, location and other multi-entity requests intact.
  if (/\b(projects?|apartments?|villas?|townhouses?|under|below|budget|compare|versus|vs\.?|in dubai|in abu dhabi)\b/i.test(original)) {
    return original;
  }
  let candidate = original
    .replace(/^(?:(?:please|can you|could you|would you)\s+)?(?:show(?:\s+me)?|find(?:\s+me)?|search(?:\s+for)?|look\s+up|explore|view|see|tell\s+me\s+(?:more\s+)?about|what\s+do\s+you\s+(?:know|think)\s+(?:about|of)|what\s+about|how\s+about|i\s+(?:want|would\s+like)\s+to\s+(?:know|learn)\s+(?:more\s+)?about|who\s+is|what\s+is|info(?:rmation)?\s+about|about)\s+/i, "")
    .replace(/\s+and\s+(?:show(?:\s+me)?|give\s+me)\s+(?:its|their|the)\s+(?:developer\s+)?(?:profile|overview|details)\s*[.!?]*$/i, "")
    .replace(/\s+(?:developer|company|profile|builder)\s*[.!?]*$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!candidate || candidate.split(/\s+/).length > 5) return original;
  const title = await d4CanonicalDeveloperName(candidate);
  // Preserve what user typed in the UI, but use canonical entity intent in Worker.
  return title ? `Find ${title}` : original;
}




// BLOCK_D_D5_NAMED_REGISTRY_FIRST_V3
// Extract a candidate identity (not a predicted answer) from an explicit
// singular district/area request. Any name MUST be verified by D5 Registry.
// Category / qualitative / project / developer searches remain separate.
function primaD5NamedDistrictCandidateV3(message) {
  const original = String(message || "").trim();
  if (!original || original.length > 180 ||
      !/^(?:please\s+)?(?:find|show(?:\s+me)?|explore|view|tell\s+me\s+about|look\s+up)\b/i.test(original) ||
      !/\b(?:district|area|community|neighbou?rhood)\b/i.test(original) ||
      /\b(?:districts|areas|communities|neighbou?rhoods|projects?|developers?|properties|apartments?|villas?|townhouses?|compare|recommend|suggest|aed|budget)\b/i.test(original)) {
    return null;
  }

  let candidate = original.replace(/[.!?]+$/, "").trim()
    .replace(/\s+(?:and\s+)?(?:show|give)(?:\s+me)?\s+(?:its|their|the)\s+(?:district\s+|area\s+|community\s+)?(?:profile|overview|details)$/i, "")
    .replace(/\s+(?:profile|overview|details)$/i, "")
    .replace(/^(?:please\s+)?(?:find|show(?:\s+me)?|explore|view|tell\s+me\s+about|look\s+up)\s+/i, "")
    .replace(/^(?:the\s+)?(?:district|area|community|neighbou?rhood)(?:\s+(?:of|called|named))?\s+/i, "")
    .replace(/\s+(?:district|area|community|neighbou?rhood)$/i, "")
    .trim();

  if (!candidate || candidate.length > 95 ||
      !/^[a-z][a-z0-9 .'&-]*$/i.test(candidate)) return null;
  return candidate;
}

// BLOCK_D_D5_NAMED_DISTRICT_CONTEXT_HANDOFF_V4
// Only D5 Registry-verified, exact single-entity identities are eligible.
// This builds a SearchContext, NOT an answer or a new search result.
function primaD5VerifiedNamedDistrictContextV4(area, query) {
  if (!area || area.entity_type !== "district") return null;
  const slug = String(area.slug || "");
  const title = String(area.title || "").trim();
  const canonical = String(area.canonical_url || "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !title || title.length > 200 ||
      canonical !== "/en/areas/" + slug + "/") return null;
  const text = String(query || "").trim();
  if (!text || text.length > 500) return null;
  return {
    version: "SearchContextV1",
    source: "prima_ui_verified_named_district_v4",
    language: "en",
    entity_type: "district",
    query: text,
    state: "results",
    result_count: 1,
    results_shown: 1,
    current_batch_offset: 0,
    filters: {},
    results: [{entity_type: "district", slug, title,
      canonical_url: canonical, rank: 1}]
  };
}

// D5_VERIFIED_SHORT_NAMES_V2
async function d5VerifyShortDistrictV2(text) {
  const q = String(text || "").trim();
  if (q.length < 3 || q.length > 95) return null;

  const explicit = q.match(
    /^(?:find|show me|explore)\s+(.+?)\s*[.!?]?$/i
  );

  const shortSingle = /^(?:downtown|palm|jvc|jvt)$/i.test(q);
  const bare = !explicit &&
    /^[a-z][a-z0-9 '&.-]{1,89}$/i.test(q) &&
    (q.includes(" ") || shortSingle);

  if (!explicit && !bare) return null;

  const original = String(explicit?.[1] || q).trim();
  if (/\b(?:projects?|developers?|properties|villas?|apartments?|townhouses?|budget|under|below|aed)\b/i.test(original)) {
    return null;
  }

  const normalize = value => String(value || "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const aliases = {
    jvc: "Jumeirah Village Circle",
    jvt: "Jumeirah Village Triangle"
  };

  const name = aliases[normalize(original)] || original;
  const wanted = normalize(name);

  const url = new URL("/__prima_d5_districts", API_BASE);
  url.searchParams.set("q", "Find " + name);

  const response = await fetch(url);
  if (!response.ok) return null;

  const batch = await response.json();
  if (batch?.version !== "DistrictDiscoveryV1" ||
      !Array.isArray(batch.results) ||
      !batch.results.length) return null;

  // Accept only exact names or complete-word prefixes.
  if (!batch.results.every(row => {
    const title = normalize(row.title);
    return title === wanted || title.startsWith(wanted + " ");
  })) return null;

  if (batch.result_count === 1) {
    return {mode:"district", district:batch.results[0]};
  }

  return {mode:"choice", data:batch, name:original};
}

// D5_DISTRICT_UI_V1 — isolated district discovery and linked entities.
// D5_13_CROSS_ENTITY_UI_V1
// Reuse existing district cards and project rendering.
function isD5CrossDistrictIntentV1(value) {
  const q = String(value || "").trim();

  return (
    /\b(?:districts?|areas?|communities|neighbou?rhoods?)\b/i.test(q) &&
    (
      /\b(?:projects?|villas?|apartments?|townhouses?)\s+by\s+[a-z]/i.test(q) ||
      /\b(?:with|have|has)\s+[a-z][a-z0-9 .'&-]{0,80}\s+(?:projects?|villas?|apartments?|townhouses?)\b/i.test(q)
    )
  );
}

// D6_CONTEXTUAL_DEVELOPER_DISTRICT_V1
// Follow-up intent adapter only. Existing D4/D5 engines stay LOCKED.
function d6ContextualDeveloperDistrictQueryV1(message, context) {
  if (
    context?.version !== "SearchContextV1" ||
    context?.entity_type !== "project"
  ) return null;

  const developer = String(
    context.filters?.developer || ""
  ).trim();

  if (
    !developer ||
    developer.length > 95 ||
    !/^[a-z][a-z0-9&.' -]*$/i.test(developer)
  ) return null;

  const text = String(message || "").trim();

  // D6_SEARCH_SLOT_REFINEMENT_V2 — Search-only deterministic slot update.
  // Resolve a verified developer + district from the previous SearchContext,
  // and accept any word order for a supported budget constraint.
  // This never chooses a developer by keyword or invents a location.
  const priorDistrict = String(
    context.results?.find(item =>
      item?.district && typeof item.district === "string"
    )?.district ||
    context.filters?.district ||
    ""
  ).trim().replace(/-/g, " ");

  const budgetSlot = text.match(
    /\b(?:under|below|less\s+than|up\s+to|within|maximum|max|budget\s+(?:of|to|at)|lower\s+(?:my\s+)?budget\s+to)\s*(?:AED\s*)?([\d,]+(?:\.\d+)?)\s*(million|thousand|m|k)?\b/i
  );
  const budgetAmount = budgetSlot
    ? Number(budgetSlot[1].replace(/,/g, ""))
    : null;
  const budgetUnit = String(budgetSlot?.[2] || "").toLowerCase();
  const budgetMultiplier = ["million", "m"].includes(budgetUnit)
    ? 1000000 : ["thousand", "k"].includes(budgetUnit) ? 1000 : 1;
  const budgetMax = budgetAmount === null
    ? null : budgetAmount * budgetMultiplier;

  const sameDeveloperReference =
    /\b(?:same|previous|last|that|this)\s+(?:developer|builder)\b/i.test(text) ||
    /\b(?:their|its)\s+projects?\b/i.test(text) ||
    /\bkeep\s+(?:the\s+)?(?:developer|same)\b/i.test(text) ||
    (/\bkeep\b/i.test(text) &&
      developer.split(/\s+/)[0].length >= 4 &&
      new RegExp("\\b" + developer.split(/\s+/)[0] + "\\b", "i").test(text));
  const projectRefinement =
    /\b(?:projects?|properties|apartments?|villas?|townhouses?|options)\b/i.test(text) ||
    sameDeveloperReference;
  const newBudgetConstraint =
    Number.isSafeInteger(budgetMax) && budgetMax > 0;
  const newDistrictConstraint = text.match(
    /\bin\s+([a-z][a-z0-9&.' -]{1,89}?)(?=\s+(?:under|below|less\s+than|up\s+to|within|from|by|but)\b|[.!?]|$)/i
  );
  const hasSearchRefinementIntent =
    sameDeveloperReference ||
    /\b(?:show|find|list|only|just|now|keep|lower|change|reduce|budget|what about|how about)\b/i.test(text) ||
    /^(?:under|below|within)\b/i.test(text);

  if (newBudgetConstraint && projectRefinement && hasSearchRefinementIntent) {
    const districtMention = String(newDistrictConstraint?.[1] || "").trim();
    // C_D_VERIFIED_DISTRICT_COREFERENCE_V8:
    // Only a previously verified D5 SearchContext may resolve "that district".
    // These words are references, never district names or search terms.
    // Explicit new district names still go through the existing D5 Registry.
    const previousDistrictReference =
      /^(?:(?:the\s+)?same|that|this|the|previous|last)\s+(?:district|area|community|neighbou?rhood)$/i
        .test(districtMention);
    const unverifiedNewDistrictReference =
      /^(?:another|different|other)\s+(?:district|area|community|neighbou?rhood)$/i
        .test(districtMention);
    if (unverifiedNewDistrictReference) return null;
    const district = String(
      previousDistrictReference ? priorDistrict : (districtMention || priorDistrict)
    ).trim();
    if (previousDistrictReference && !priorDistrict) return null;
    if (district.length >= 2 && district.length <= 90 &&
        /^[a-z][a-z0-9&.' -]*$/i.test(district)) {
      const kindMatch = text.match(/\b(villas?|apartments?|townhouses?)\b/i);
      const kinds = {villa:"villas",villas:"villas",apartment:"apartments",apartments:"apartments",townhouse:"townhouses",townhouses:"townhouses"};
      const kind = kinds[String(kindMatch?.[1] || "").toLowerCase()] || "projects";
      return `${kind} by ${developer} in ${district} under AED ${budgetMax}`;
    }
  }

  const scoped = text.match(
    /^(?:now\s+)?(?:show(?:\s+me)?\s+)?(?:only\s+)?(?:their\s+)?(projects?|villas?|apartments?|townhouses?)\s+in\s+(.+?)\s*[.!?]?$/i
  );

  const locationOnly = text.match(
    /^(?:now\s+)?(?:show(?:\s+me)?\s+)?only\s+in\s+(.+?)\s*[.!?]?$/i
  );

  if (!scoped && !locationOnly) return null;

  const district = String(
    scoped?.[2] || locationOnly?.[1] || ""
  ).trim();

  if (
    district.length < 2 ||
    district.length > 90 ||
    !/^[a-z][a-z0-9&.' -]*$/i.test(district)
  ) return null;

  const propertyTypes = {
    project: "projects",
    projects: "projects",
    villa: "villas",
    villas: "villas",
    apartment: "apartments",
    apartments: "apartments",
    townhouse: "townhouses",
    townhouses: "townhouses"
  };

  const kind = propertyTypes[
    String(scoped?.[1] || "projects").toLowerCase()
  ];

  if (!kind) return null;

  // Only the internal lookup receives the verified, explicit query.
  // The user's original message remains unchanged.
  return `${kind} by ${developer} in ${district}`;
}

function parseD5CrossProjectIntentV1(value) {
  const q = String(value || "").trim();

  const match = q.match(
    /^(?:(?:show me|show|find|list)\s+)?(projects|villas|apartments|townhouses)\s+by\s+(.{2,80}?)\s+in\s+(.{2,90}?)(?:\s+(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?)?\s*[.!?]?$/i
  );

  if (!match) return null;

  const kind = match[1].toLowerCase();
  const developer = match[2].trim();
  const districtName = match[3].trim();

  if (!developer || !districtName) return null;

  let budget = null;

  if (match[4]) {
    const amount = Number(match[4].replace(/,/g, ""));
    const scale = String(match[5] || "").toLowerCase();

    const multiplier =
      ["million", "m"].includes(scale) ? 1000000 :
      ["thousand", "k"].includes(scale) ? 1000 : 1;

    budget = amount * multiplier;

    if (!Number.isSafeInteger(budget) || budget <= 0) {
      return null;
    }
  }

  return {
    developer,
    districtName,
    propertyType: {
      villas:"villa",
      apartments:"apartment",
      townhouses:"townhouse"
    }[kind] || null,
    budget
  };
}

async function tryD5DistrictRequestV1(text, initialResponse) {
  const q = String(text || "").trim();

  // D5-13: Developer-filtered projects in a verified district.
  const crossProject = parseD5CrossProjectIntentV1(q);

  if (crossProject) {
    const lookup = new URL("/__prima_d5_districts", API_BASE);
    lookup.searchParams.set(
      "q", "Find " + crossProject.districtName
    );

    const lookupResponse = await fetch(lookup);

    if (!lookupResponse.ok) {
      throw new Error(
        "D5 cross district HTTP " + lookupResponse.status
      );
    }

    const lookupBatch = await lookupResponse.json();

    const normalize = value => String(value || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const area = lookupBatch?.results?.find(item =>
      normalize(item.title) ===
        normalize(crossProject.districtName) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) &&
      item.canonical_url ===
        "/en/areas/" + item.slug + "/"
    );

    if (!area) return null;

    const url = new URL("/__prima_d5_districts", API_BASE);

    url.searchParams.set("district", area.slug);
    url.searchParams.set("developer", crossProject.developer);

    if (crossProject.propertyType) {
      url.searchParams.set(
        "property_type", crossProject.propertyType
      );
    }

    if (crossProject.budget !== null) {
      url.searchParams.set(
        "max_price", String(crossProject.budget)
      );
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        "D5 cross projects HTTP " + response.status
      );
    }

    const batch = await response.json();

    if (
      batch?.version !== "SearchContextV1" ||
      !Array.isArray(batch.results) ||
      batch.filters?.district !== area.slug ||
      batch.filters?.developer !== crossProject.developer ||
      (crossProject.propertyType &&
        batch.filters?.property_type !== crossProject.propertyType) ||
      (crossProject.budget !== null &&
        Number(batch.filters?.budget_max) !== crossProject.budget)
    ) {
      throw new Error("Invalid D5 cross-project response");
    }

    return {mode:"projects", context:batch};
  }

  // D5-13: District discovery filtered by developer.
  if (isD5CrossDistrictIntentV1(q)) {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("q", q);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        "D5 cross districts HTTP " + response.status
      );
    }

    const batch = await response.json();

    if (
      batch?.version === "DistrictDiscoveryV1" &&
      batch.search_mode === "developer_district" &&
      Array.isArray(batch.results)
    ) {
      return {mode:"list", data:batch};
    }
  }

  // D5_BUDGET_COMBINED_UI_V1
  // Use the existing verified D5 Worker contract.
  if (
    /\b(?:districts?|areas?|communities|neighbou?rhoods?)\b/i.test(q) &&
    /\baed\b/i.test(q) &&
    /\b(?:under|below|up to|within|max|maximum)\b/i.test(q)
  ) {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("q", q);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("D5 budget HTTP " + response.status);
    }

    const batch = await response.json();

    if (
      batch?.version === "DistrictDiscoveryV1" &&
      ["budget", "combined"].includes(batch.search_mode) &&
      Array.isArray(batch.results)
    ) {
      return {mode:"list",data:batch};
    }
  }

  // D5_INTELLIGENT_UI_REQUEST_V1
  // Only verified qualitative matches use this route.
  if (
    /\b(?:districts?|areas?|neighbou?rhoods?|communities)\b/i.test(q) &&
    /\b(?:family|families|children|child|kids|schools|invest|investment|investing|investors?|income|waterfront|beachfront|beach|coastal|seaside|island|green|parks?|nature|landscaped|quiet|calm|peaceful|tranquil)\b/i.test(q) &&
    !/\b(?:projects?|developers?|luxury|premium|affordable|cheap|expensive|budget|aed|million|yield|roi|under|below|up to)\b/i.test(q)
  ) {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("q", q);

    const response = await fetch(url);
    if (response.ok) {
      const batch = await response.json();

      if (
        batch?.version === "DistrictDiscoveryV1" &&
        batch.search_mode === "intelligent" &&
        Array.isArray(batch.results)
      ) {
        return {mode:"list",data:batch};
      }
    }
  }

  // D5_EMIRATE_ROUTING_V1
  const geographicMatch = q.match(
    /^(?:(?:show(?: me)?|find|list|browse)\s+)?(?:all\s+)?(?:the\s+)?(?:districts|areas|neighbou?rhoods|communities)\s+in\s+(dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|uaq|rak)\s*[.!?]?$/i
  );

  if (geographicMatch) {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("q", q);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("D5 emirate HTTP " + response.status);
    }

    const batch = await response.json();

    if (
      batch?.version !== "DistrictDiscoveryV1" ||
      !batch.emirate ||
      !Array.isArray(batch.results)
    ) {
      throw new Error("Invalid D5 emirate contract");
    }

    return {mode:"list", data:batch};
  }



  // D5_DISTRICT_LIST_V1 — registry-backed alphabetical listing.
  if (/^(?:show(?: me)?|list|find|browse)\s+(?:all\s+)?(?:the\s+)?(?:districts|areas)\s*[.!?]?$/i.test(q)) {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("q", "Show districts");

    const response = await fetch(url);
    if (!response.ok) throw new Error("D5 list HTTP " + response.status);

    const batch = await response.json();
    if (batch.version !== "DistrictDiscoveryV1" ||
        !Array.isArray(batch.results)) {
      throw new Error("Invalid D5 list contract");
    }

    return {mode:"list", data:batch};
  }

  const match = q.match(/^(?:(?:show me|show|find|list)\s+)?(?:all\s+)?(projects|villas|apartments|townhouses|developers)\s+in\s+(.+?)(?:\s+(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?)?\s*[.!?]?$/i);
  // D5_SINGLE_DISTRICT_UNIFIED_V1
  // Explicit search or bare name; exact Registry verification follows.
  const explicitDistrict = !match && q.match(
    /^(?:find|show me|tell me (?:more )?about|explore)\s+(.{2,90}?)\s*[.!?]?$/i
  );
  const bareDistrict = !match && !explicitDistrict &&
    /^[a-z][a-z0-9 '&.-]{1,89}$/i.test(q)
      ? [q, q]
      : null;
  const bare = explicitDistrict || bareDistrict;

  if (!match && !bare) return null;
  if (bare && initialResponse?.action === "search_developers") return null;

  const candidate = String(match?.[2] || bare?.[1] || "").trim();
  if (!candidate ||
      (bare && /\b(?:projects?|villas?|apartments?|developers?|under|budget|aed|bedrooms?)\b/i.test(candidate))) {
    return null;
  }

  const lookup = new URL("/__prima_d5_districts", API_BASE);
  lookup.searchParams.set("q", "Find " + candidate);

  const response = await fetch(lookup);
  if (!response.ok) throw new Error("D5 lookup HTTP " + response.status);

  const batch = await response.json();
  if (batch?.version !== "DistrictDiscoveryV1" ||
      !Array.isArray(batch.results) ||
      batch.result_count !== 1) return null;

  const district = batch.results[0];
  const normalized = v => String(v || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();

  if (normalized(candidate) !== normalized(district.title)) return null;
  if (!match) return {
    mode: /^tell me (?:more )?about\b/i.test(q)
      ? "discuss" : "district",
    district
  };

  const kind = match[1].toLowerCase();
  const url = new URL("/__prima_d5_districts", API_BASE);
  url.searchParams.set("district", district.slug);

  if (kind === "developers") {
    url.searchParams.set("mode", "developers");
  }

  if (["villas", "apartments", "townhouses"].includes(kind)) {
    url.searchParams.set("property_type", kind.slice(0, -1));
  }

  if (match[3]) {
    const amount = Number(match[3].replace(/,/g, ""));
    const unit = String(match[4] || "").toLowerCase();
    const scale = ["m", "million"].includes(unit) ? 1000000
      : ["k", "thousand"].includes(unit) ? 1000 : 1;

    if (!Number.isFinite(amount) || amount <= 0) return null;
    url.searchParams.set("max_price", String(amount * scale));
  }

  const related = await fetch(url);
  if (!related.ok) throw new Error("D5 result HTTP " + related.status);

  const data = await related.json();

  if (kind === "developers" &&
      data?.version === "DistrictDevelopersV1" &&
      Array.isArray(data.results)) {
    return {mode:"developers", district, data};
  }

  if (data?.version === "SearchContextV1" &&
      Array.isArray(data.results)) {
    return {mode:"projects", district, context:{...data, query:q}};
  }

  throw new Error("Invalid D5 result contract");
}



// PRIMA_ENTITY_CARD_OPEN_V1 — card click opens canonical page.
function enablePrimaEntityCardLinkV1(card, path, type) {
  const value = String(path || "");
  const valid = type === "district"
    ? /^\/en\/areas\/[a-z0-9-]+\/$/.test(value)
    : /^\/en\/developers\/[a-z0-9-]+\/$/.test(value);

  if (!valid || card.dataset.primaCardOpen === "1") return;

  card.dataset.primaCardOpen = "1";
  card.classList.add("prima-entity-open-card");
  card.tabIndex = 0;
  card.setAttribute("aria-label", "Open " + type + " page");

  const open = () => window.open(
    "https://primadom.ai" + value,
    "_blank",
    "noopener"
  );

  // Capture phase prevents existing card background handlers
  // from triggering a second, conflicting action.
  card.addEventListener("click", event => {
    if (event.target?.closest?.(
      "button,a,input,select,textarea,[role='button']"
    )) return;

    event.stopImmediatePropagation();
    open();
  }, true);

  card.addEventListener("keydown", event => {
    if (event.target !== card || event.key !== "Enter") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  });

  if (!document.getElementById("prima-entity-open-style")) {
    const style = document.createElement("style");
    style.id = "prima-entity-open-style";
    style.textContent = `
      .prima-entity-open-card {
        cursor: pointer !important;
        transition: border-color .16s ease, box-shadow .16s ease;
      }
      .prima-entity-open-card:hover,
      .prima-entity-open-card:focus-visible {
        border-color: rgba(231,151,112,.5) !important;
        box-shadow: 0 0 0 1px rgba(231,151,112,.13);
      }
      .prima-entity-open-card button {
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }
}


// D5_PROJECT_PAGINATION_V2
// Uses existing project cards; does not alter D3 pagination.
async function renderD5DistrictProjectPagesV2(
  firstBatch,
  originalQuery,
  assistantMessage
) {
  if (
    firstBatch?.version !== "SearchContextV1" ||
    !Array.isArray(firstBatch.results)
  ) {
    throw new Error("Invalid D5 project context");
  }

  // D5_SEARCH_CONTEXT_HANDOFF_V1
  // Preserve verified results for follow-up and single-project cards.
  // Search engines, ranking and Registry remain unchanged.
  state.searchContext = firstBatch;
  state.searchPagination = null;
  state.lastSearchQuery = originalQuery;

  const filters = firstBatch.filters || {};
  const district = String(filters.district || "");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(district)) {
    throw new Error("Invalid D5 district");
  }

  const total = Number(firstBatch.result_count || 0);
  const shown = new Set();

  let nextOffset = 0;
  let toolbar = null;
  let prefetched = null;

  const endpoint = offset => {
    const url = new URL("/__prima_d5_districts", API_BASE);
    url.searchParams.set("district", district);
    url.searchParams.set("offset", String(offset));

    if (filters.developer) {
      url.searchParams.set(
        "developer", String(filters.developer)
      );
    }

    if (filters.property_type) {
      url.searchParams.set(
        "property_type",
        String(filters.property_type)
      );
    }

    if (filters.budget_max != null) {
      url.searchParams.set(
        "max_price",
        String(filters.budget_max)
      );
    }

    return url;
  };

  const fetchBatch = async offset => {
    const response = await fetch(endpoint(offset));

    if (!response.ok) {
      throw new Error("D5 pagination HTTP " + response.status);
    }

    const batch = await response.json();

    if (
      batch?.version !== "SearchContextV1" ||
      !Array.isArray(batch.results) ||
      batch.filters?.district !== district ||
      batch.current_batch_offset !== offset ||
      (filters.developer &&
        batch.filters?.developer !== filters.developer)
    ) {
      throw new Error("Invalid D5 pagination response");
    }

    return batch;
  };

  const prefetch = offset => {
    const promise = fetchBatch(offset);
    prefetched = {offset, promise};

    promise.catch(error =>
      console.warn("d5_project_prefetch_failed", error)
    );
  };

  const drawBatch = batch => {
    const rows = batch.results.filter(project => {
      const url = String(project?.canonical_url || "");

      if (
        !/^\/en\/projects\/[a-z0-9-]+\/$/.test(url) ||
        shown.has(url)
      ) return false;

      shown.add(url);
      return true;
    });

    if (rows.length) {
      // D5_CARD_ROW_GAP_V2
      const previousCards = new Set(
        dynamic.querySelectorAll(".cards .card")
      );

      renderCards(rows.map(project => ({
        slug: project.slug,
        canonical_url: project.canonical_url,
        gallery_1: project.gallery_1,
        image_alt: project.image_alt,
        facts: {
          title: project.title,
          district: project.district,
          developer: project.developer,
          price_display: project.price_display
        }
      })));

      // Apply spacing to newly rendered D5 cards only.
      for (const card of dynamic.querySelectorAll(".cards .card")) {
        if (previousCards.has(card)) continue;

        card.classList.add("prima-d5-project-item");
        card.style.setProperty(
          "margin-bottom", "16px", "important"
        );
      }
    }

    /*
      E2_ACTIVE_SEARCH_BATCH_CONTEXT_V1

      Keep all verified results accumulated so far,
      but make the most recently displayed batch
      authoritative for ordinal follow-ups.

      Project ranking and D5 API are unchanged.
    */
    const e2Previous = state.searchContext;
    const e2Offset = Number(batch?.current_batch_offset);

    const e2SameSearch =
      e2Previous?.version === "SearchContextV1" &&
      batch?.version === "SearchContextV1" &&
      e2Previous?.entity_type === "project" &&
      batch?.entity_type === "project" &&
      String(e2Previous?.filters?.district || "") ===
        String(batch?.filters?.district || "") &&
      String(e2Previous?.filters?.developer || "") ===
        String(batch?.filters?.developer || "") &&
      Number(e2Previous?.result_count) ===
        Number(batch?.result_count);

    const e2ValidBatch =
      Number.isInteger(e2Offset) &&
      e2Offset >= 0 &&
      Array.isArray(e2Previous?.results) &&
      Array.isArray(batch?.results) &&
      batch.results.length > 0 &&
      batch.results.every(item =>
        item?.entity_type === "project" &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
          String(item.slug || "")
        )
      );

    if (
      e2SameSearch &&
      e2ValidBatch &&
      e2Offset <= e2Previous.results.length
    ) {
      const e2Results =
        e2Offset === 0
          ? []
          : e2Previous.results.slice();

      for (let i = 0; i < batch.results.length; i++) {
        e2Results[e2Offset + i] = batch.results[i];
      }

      state.searchContext = {
        ...e2Previous,
        results: e2Results,
        current_batch_offset: e2Offset
      };

      console.info(
        "e2_search_context_batch_updated",
        {
          entity_type: "project",
          active_offset: e2Offset,
          accumulated_results: e2Results.length,
          active_titles: batch.results.map(
            item => item.title
          )
        }
      );
    } else {
      console.warn(
        "e2_search_context_batch_not_updated",
        {
          offset: e2Offset,
          previous_count: e2Previous?.results?.length,
          same_search: e2SameSearch,
          valid_batch: e2ValidBatch
        }
      );
    }

    nextOffset =
      Number(batch.current_batch_offset || 0) +
      batch.results.length;

    if (toolbar) toolbar.remove();

    toolbar = document.createElement("div");
    toolbar.className = "quick";
    toolbar.dataset.primaD5ProjectActions = "1";

    // D5_PROJECT_TOOLBAR_LIFT_V1
    // Visual adjustment only — move actions 8px closer to cards.
    toolbar.style.transform = "translateY(-8px)";

    const addAction = (label, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", handler);
      toolbar.appendChild(button);
      return button;
    };

    if (nextOffset < total && batch.results.length) {
      let loading = false;

      const more = addAction("Show 3 more", async () => {
        if (state.busy || loading) return;

        loading = true;
        more.disabled = true;
        more.textContent = "Loading...";

        try {
          const warmed =
            prefetched?.offset === nextOffset
              ? await prefetched.promise.catch(() => null)
              : null;

          const next =
            warmed || await fetchBatch(nextOffset);

          drawBatch(next);
          scrollToBottom();
        } catch (error) {
          console.error("D5 project pagination failed", error);
          loading = false;
          more.disabled = false;
          more.textContent = "Show 3 more";
        }
      });

      prefetch(nextOffset);
    }

    addAction("Refine search", () => {
      if (state.busy) return;

      input.value = originalQuery;
      input.focus();
      input.setSelectionRange?.(
        input.value.length,
        input.value.length
      );
    });

    addAction("Ask an advisor", () => {
      if (state.busy) return;

      input.value = "I'd like to speak with an advisor";
      send();
    });

    dynamic.appendChild(toolbar);
    scrollToBottom();
  };

  // C_D_RESUME_VERIFIED_D5_V10:
  // Prepare a REAL D5 next page, but do not display it before the Worker
  // confirms a Block C "resume" and persists the new SearchContext offset.
  // No separate synthetic answer and no local-only conversation mutation.
  state.d6PrepareD5ResumeV10 = async () => {
    const previous = state.searchContext;
    const sameSearch =
      previous?.version === "SearchContextV1" &&
      previous?.entity_type === "project" &&
      previous?.state === "results" &&
      previous?.filters?.district === district &&
      String(previous?.filters?.developer || "") ===
        String(filters.developer || "") &&
      Number(previous?.result_count) === total &&
      Array.isArray(previous?.results) &&
      previous.results.length === nextOffset &&
      nextOffset > 0 && nextOffset < total && nextOffset < 9;
    if (!sameSearch) return null;

    const offset = nextOffset;
    const warmed = prefetched?.offset === offset
      ? await prefetched.promise.catch(() => null) : null;
    const batch = warmed || await fetchBatch(offset);
    const valid = batch?.results?.length > 0 &&
      batch.results.length <= 3 &&
      batch.result_count === total &&
      batch.results.every(p =>
        p?.entity_type === "project" &&
        /^\/en\/projects\/[a-z0-9-]+\/$/.test(String(p.canonical_url || "")) &&
        !shown.has(p.canonical_url)
      );
    if (!valid) return null;

    const rows = previous.results.slice(0, offset).concat(batch.results);
    if (rows.length !== offset + batch.results.length || rows.length > 10)
      return null;
    const searchContext = {
      ...firstBatch,
      results: rows,
      current_batch_offset: offset,
      next_offset: rows.length,
      has_more: rows.length < total
    };
    return {
      offset,
      searchContext,
      commit: () => {
        if (state.searchContext !== previous || nextOffset !== offset)
          throw new Error("D5 session changed during resume");
        drawBatch(batch);
      }
    };
  };

  // D5_13_CONTEXTUAL_PROJECT_ANSWERS_V1
  // State what, where, by whom and within which budget.
  const contextFilters = firstBatch.filters || {};

  const rawDistrict = String(
    contextFilters.district || ""
  );

  const districtFromQuery = String(originalQuery || "").match(
    /\bin\s+(.+?)(?:\s+(?:under|below|up to)\s+(?:AED\s*)?[\d,.]+\s*(?:million|thousand|m|k)?)?\s*[.!?]?\s*$/i
  );

  const districtLabel = districtFromQuery?.[1]?.trim() ||
    rawDistrict.split("-")
      .map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join(" ");

  const propertyLabel = {
    villa: "villa projects",
    apartment: "apartment projects",
    townhouse: "townhouse projects"
  }[String(contextFilters.property_type || "").toLowerCase()] ||
    "projects";

  const developerLabel = String(
    contextFilters.developer || ""
  ).trim();

  const rawBudget = contextFilters.budget_max;

  const budget = rawBudget == null
    ? null
    : Number(rawBudget);

  const budgetLabel =
    budget !== null &&
    Number.isSafeInteger(budget) &&
    budget > 0
      ? " under AED " + budget.toLocaleString("en-US")
      : "";

  const scope =
    propertyLabel +
    (developerLabel ? " by " + developerLabel : "") +
    " in " + districtLabel +
    budgetLabel;

  const message = total === 0
    ? "I couldn't find " + scope +
      " in the current Primadom project catalog."
    : total === 1
      ? "I found 1 " + scope +
        ". Here is the matching project."
      : "I found " + total + " " + scope +
        ". Here are the first " +
        Math.min(3, total) + " of " + total + ".";

  await revealText(assistantMessage, message);

  drawBatch(firstBatch);
}

// D5_DISTRICT_CARDS_V1 — isolated district card renderer.
// Existing D3 and D4 card renderers remain unchanged.

async function renderD5DistrictCardV1(area, suppliedProfile = null) {
  const slug = String(area?.slug || "");
  const canonical = String(area?.canonical_url || "");
  const title = String(area?.title || "");

  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    canonical !== `/en/areas/${slug}/`
  ) return;

  const endpoint = params =>
    new URL(
      "/__prima_d5_districts?" +
      new URLSearchParams({
        district: slug,
        ...params
      }),
      API_BASE
    );

  const load = async params => {
    try {
      const response = await fetch(endpoint(params));
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };

  const [profile, portfolio] = await Promise.all([
    suppliedProfile || load({mode: "profile"}),
    load({})
  ]);

  const count = Number.isInteger(portfolio?.result_count)
    ? portfolio.result_count
    : null;

  const wrap = document.createElement("div");
  wrap.className = "cards prima-district-cards prima-district-single";
  wrap.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr);" +
    "width:100%;max-width:500px;gap:12px";

  const card = document.createElement("article");
  card.className = "card prima-district-card";
  card.style.cssText =
    "display:block;width:100%;max-width:100%;" +
    "overflow:hidden;border-radius:22px";

  enablePrimaEntityCardLinkV1(card, canonical, "district");

  const media = document.createElement("div");
  media.className = "media";
  media.style.cssText =
    "position:relative;width:100%;height:auto;" +
    "aspect-ratio:2/1;overflow:hidden;" +
    "background:rgba(255,255,255,.035)";

  if (profile?.image) {
    const image = document.createElement("img");

    image.src = profile.image;
    image.alt = profile.image_alt || title;
    image.loading = "lazy";
    image.style.cssText =
      "display:block;width:100%;height:100%;" +
      "object-fit:cover";

    media.appendChild(image);
  }

  const body = document.createElement("div");
  body.className = "card-body";
  body.style.cssText = "padding:15px 17px 17px";

  const headingRow = document.createElement("div");
  headingRow.style.cssText =
    "display:flex;align-items:baseline;" +
    "justify-content:space-between;" +
    "gap:12px;flex-wrap:wrap";

  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.style.cssText =
    "margin:0;font-size:22px;" +
    "line-height:1.25";

  headingRow.appendChild(heading);

  if (profile?.city) {
    const location = document.createElement("span");
    location.textContent = profile.city + ", UAE";
    location.style.cssText =
      "font-size:12px;color:rgba(255,255,255,.65);" +
      "white-space:nowrap";

    headingRow.appendChild(location);
  }

  body.appendChild(headingRow);

  if (profile?.subtitle) {
    const description = document.createElement("p");
    description.textContent = profile.subtitle;
    description.style.cssText =
      "font-size:13px;line-height:1.5;" +
      "margin:9px 0 0;" +
      "color:rgba(255,255,255,.78)";

    body.appendChild(description);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.cssText =
    "display:flex;gap:9px;flex-wrap:wrap;" +
    "margin-top:12px;padding-top:12px;" +
    "border-top:1px solid rgba(255,255,255,.09)";

  const addButton = (label, primary, handler) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;

    if (primary) button.className = "primary";

    button.addEventListener("click", event => {
      event.stopPropagation();
      if (!state.busy) handler();
    });

    actions.appendChild(button);
  };

  addButton("Discuss", true, () => {
    input.value = "Tell me more about " + title;
    send();
  });

  addButton(
    count === null ? "Projects" : count + " Projects",
    false,
    () => {
      input.value = "Projects in " + title;
      send();
    }
  );

  addButton("Open page ↗", false, () => {
    window.open(
      new URL(canonical, "https://primadom.ai").href,
      "_blank",
      "noopener"
    );
  });

  body.appendChild(actions);
  card.append(media, body);
  wrap.appendChild(card);
  dynamic.appendChild(wrap);

  scrollToBottom();
}


// D5_DISTRICT_LIST_RENDER_V1 — compact district cards.
async function renderD5DistrictListV1(firstBatch, textReady, f213Limit = Infinity) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "width:100%;display:grid;gap:14px";

  let grid = document.createElement("div");
  grid.className = "prima-district-list";
  grid.style.cssText =
    "display:grid;grid-template-columns:" +
    "repeat(3,minmax(0,1fr));gap:12px;align-items:start";

  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "Show 3 more";
  more.className = "prima-d5-more";
  more.style.cssText =
    "display:inline-flex;align-items:center;justify-content:center;" +
    "width:max-content;max-width:100%;justify-self:start;" +
    "padding:10px 17px;border-radius:999px;" +
    "background:#252321 !important;color:#f5f1ed !important;" +
    "border:1px solid rgba(255,255,255,.15) !important;" +
    "font:inherit;font-size:12px;line-height:1.2;" +
    "cursor:pointer;box-shadow:none;";


  // D5_LIST_THREE_COLUMNS — responsive, scoped to district lists.
  if (!document.getElementById("prima-d5-list-responsive")) {
    const style = document.createElement("style");
    style.id = "prima-d5-list-responsive";
    style.textContent = `
      @media (max-width: 900px) {
        .prima-district-list {
          grid-template-columns: repeat(2,minmax(0,1fr)) !important;
        }
      }
      @media (max-width: 600px) {
        .prima-district-list {
          grid-template-columns: minmax(0,1fr) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "display:flex;gap:9px;flex-wrap:wrap;align-items:center";

  const extraButton = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = "prima-d5-more";
    button.style.cssText = more.style.cssText;
    button.addEventListener("click", action);
    return button;
  };

  const refine = extraButton("Refine search", () => {
    if (state.busy) return;
    input.value = String(firstBatch.query || "Show districts");
    input.focus();
    input.setSelectionRange?.(
      input.value.length,
      input.value.length
    );
  });

  const advisor = extraButton("Ask an advisor", () => {
    if (state.busy) return;
    input.value = "I'd like to speak with an advisor";
    send();
  });

  toolbar.append(more, refine, advisor);

  // Match the existing D4/D3 search action styling.
  toolbar.className = "quick prima-developer-actions";
  toolbar.removeAttribute("style");

  for (const button of [more, refine, advisor]) {
    button.className = "";
    button.removeAttribute("style");
  }

  // D5_ATOMIC_LIST_RENDER_V1 — prepare before display.
  wrapper.append(grid, toolbar);

  let nextOffset = 0;

  const endpoint = params => {
    const url = new URL("/__prima_d5_districts", API_BASE);
    for (const [k,v] of Object.entries(params)) {
      url.searchParams.set(k,String(v));
    }
    return url;
  };

  const getJSON = async url => {
    try {
      const r = await fetch(url);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };


  // D5_NEXT_BATCH_PREFETCH_V1
  let cachedNext = null;

  function prefetchNext(offset) {
    const promise = (async () => {
      const batch = await getJSON(endpoint({
        q: firstBatch.query || "Show districts", offset
      }));

      if (batch?.version !== "DistrictDiscoveryV1" ||
          !Array.isArray(batch.results)) {
        return null;
      }

      const details = await Promise.all(
        batch.results.map(area => Promise.all([
          getJSON(endpoint({district:area.slug,mode:"profile"})),
          getJSON(endpoint({district:area.slug}))
        ]))
      );

      const images = details.map(([profile]) => {
        if (!profile?.image) return null;
        const image = new Image();
        image.src = profile.image;
        return image;
      });

      return {batch,details,images};
    })();

    cachedNext = {offset,promise};
    promise.catch(error =>
      console.warn("d5_prefetch_unavailable",error)
    );
  }

  const addBatch = async (
    batch,
    prepared = null,
    continuation = false
  ) => {
    const visible = batch.results.slice(0,Math.max(0,f213Limit-nextOffset));
    const items = await Promise.all(visible.map(async (area, i) => {
      const [profile, projects] = prepared?.[i] || await Promise.all([
        getJSON(endpoint({district:area.slug,mode:"profile"})),
        getJSON(endpoint({district:area.slug}))
      ]);

      const card = document.createElement("article");
      card.className = "card prima-district-list-card";
      card.style.cssText =
        "overflow:hidden;border-radius:18px;min-width:0;" +
        "align-self:start;height:auto;min-height:0";

      enablePrimaEntityCardLinkV1(
        card, area.canonical_url, "district"
      );

      // D5_EQUAL_MEDIA_V1 — same media size with or without photo.
      const media = document.createElement("div");
      media.style.cssText =
        "position:relative;width:100%;aspect-ratio:2/1;" +
        "overflow:hidden;background:rgba(255,255,255,.035)";

      if (profile?.image) {
        const image = document.createElement("img");
        image.src = profile.image;
        image.alt = area.title;
        image.loading = "lazy";
        image.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;" +
          "object-fit:cover;display:block";
        media.appendChild(image);
      }

      card.appendChild(media);

      const body = document.createElement("div");
      body.style.cssText = "padding:13px;display:grid;gap:7px";

      const title = document.createElement("strong");
      title.textContent = area.title;
      title.style.cssText = "font-size:15px;line-height:1.3";

      const city = document.createElement("span");
      city.textContent = profile?.city
        ? profile.city + ", UAE" : "UAE";
      city.style.cssText =
        "font-size:12px;color:rgba(255,255,255,.65)";

      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";

      const button = (text, action) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.className = "prima-d5-card-action";
        b.style.cssText =
          "display:inline-flex;align-items:center;justify-content:center;" +
          "width:auto;min-height:30px;padding:7px 11px;" +
          "border-radius:999px !important;" +
          "font:inherit;font-size:11px;line-height:1.2;" +
          "white-space:nowrap;cursor:pointer;box-shadow:none;" +
          (text === "Discuss"
            ? "background:#493028 !important;color:#f7e7df !important;" +
              "border:1px solid #89513b !important;"
            : "background:#282625 !important;color:#ddd8d4 !important;" +
              "border:1px solid rgba(255,255,255,.14) !important;");
        b.addEventListener("click", () => {
          if (!state.busy) action();
        });
        actions.appendChild(b);
      };

      button("Discuss", () => {
        input.value = "Tell me more about " + area.title;
        send();
      });

      const n = Number.isInteger(area.matching_project_count)
        ? area.matching_project_count
        : (Number.isInteger(projects?.result_count)
            ? projects.result_count : null);

      // D5_FILTERED_PROJECT_CARD_ACTION_V1
      // Carry the exact project filters from the district search.
      button(
        n === null ? "Projects" : n + " Projects",
        () => {
          const isFiltered =
            Number.isInteger(area.matching_project_count);

          const filters = isFiltered
            ? (firstBatch.filters || {})
            : {};

          const propertyType =
            String(filters.property_type || "").toLowerCase();

          const projectKind = {
            villa: "Villas",
            apartment: "Apartments",
            townhouse: "Townhouses"
          }[propertyType] || "Projects";

          const budget = Number(filters.budget_max);

          const budgetSuffix =
            isFiltered &&
            Number.isSafeInteger(budget) &&
            budget > 0
              ? " under AED " + budget.toLocaleString("en-US")
              : "";

          const developer =
            String(filters.developer || "").trim();

          input.value =
            projectKind +
            (developer ? " by " + developer : "") +
            " in " + area.title + budgetSuffix;

          send();
        }
      );

      button("Open page ↗", () => {
        window.open(
          new URL(area.canonical_url,"https://primadom.ai").href,
          "_blank","noopener"
        );
      });

      body.append(title,city,actions);
      card.appendChild(body);
      return card;
    }));

    // Preload photos before revealing the new batch.
    await Promise.all(items.map(async card => {
      const image = card.querySelector("img");
      if (!image || typeof image.decode !== "function") return;

      await Promise.race([
        image.decode().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 1200))
      ]);
    }));

    // D4_D5_PAGINATION_BOTTOM_V1
    // Keep old chat messages and cards in place.
    // Every continuation is a fresh result group at the bottom.
    if (continuation) {
      // Do not render stale results after New conversation.
      if (!wrapper.isConnected) return;

      const nextWrapper = document.createElement("div");
      nextWrapper.style.cssText = wrapper.style.cssText;

      const nextGrid = document.createElement("div");
      nextGrid.className = grid.className;
      nextGrid.style.cssText = grid.style.cssText;

      // Move the active actions below the new cards.
      nextWrapper.append(nextGrid, toolbar);
      dynamic.appendChild(nextWrapper);

      grid = nextGrid;
    }

    for (const card of items) grid.appendChild(card);

    primaE23SetActiveBatch(
      Number.isFinite(f213Limit) ? {...batch, results: visible} : batch,
      "district",
      firstBatch.query || "Show districts"
    );

    nextOffset =
      batch.current_batch_offset + visible.length;

    more.hidden = !batch.has_more || nextOffset >= f213Limit;
    if (batch.has_more && nextOffset < f213Limit) prefetchNext(nextOffset);
    scrollToBottom();
  };

  more.addEventListener("click", async () => {
    if (more.disabled) return;
    more.disabled = true;
    more.textContent = "Loading...";

    try {
      const warmed = cachedNext?.offset === nextOffset
        ? await cachedNext.promise.catch(() => null)
        : null;

      const batch = warmed?.batch || await getJSON(endpoint({
        q: firstBatch.query || "Show districts",
        offset:nextOffset
      }));

      if (!batch || batch.version !== "DistrictDiscoveryV1" ||
          !Array.isArray(batch.results)) {
        throw new Error("District pagination unavailable");
      }

      await addBatch(batch, warmed?.details, true);
    } catch (error) {
      console.warn("d5_list_next_failed",error);
    } finally {
      more.disabled = false;
      more.textContent = "Show 3 more";
    }
  });

  await addBatch(firstBatch);

  // Show the complete initial batch and toolbar together.
  await textReady;
  dynamic.appendChild(wrapper);
  scrollToBottom();
}


// PRIMA_CATALOG_ENTITY_HANDOFF_V1
// Verified project identity and card fields only.
// Existing D3/D4/D5 Search engines remain unchanged.

let primaCatalogPromiseV1 = null;

function primaCatalogNormalizeV1(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// PERSONA_V02_FRONTEND_ENTITY_PREFLIGHT_BOUNDARY
// This is an entity-lookup eligibility test, NEVER a Persona intent router.
// Worker owns natural-language semantics. No fixed Persona question catalog.
// Keep verified bare-name, named-entity introduction and explicit Search paths.
function primaNeedsEntityPreflightV1(message) {
  const text = String(message || "").trim();
  if (!text || text.length > 220) return false;

  // The frontend's D3/D4/D5 name resolvers are currently English-only.
  // Other scripts and non-English language should go to Worker unchanged.
  if (/[^\u0000-\u007F]/u.test(text)) return false;

  // Profile of one verified catalog entity is ONE task even if its wording
  // uses "and show me its profile". Do not apply this to comparisons/advice.
  if (/^(?:find|show me|search for)\s+.+?\s+and\s+(?:show(?:\s+me)?|give\s+me)\s+(?:its|the)\s+(?:project\s+)?(?:profile|overview|details)\s*[.!?]*$/i.test(text)) {
    const candidate = primaCatalogCandidateV1(text);
    if (candidate && candidate.split(/\s+/).length <= 7) return true;
  }

  const explicitlySearching =
    /^(?:(?:can|could|would) you (?:please )?)?(?:find|show(?: me)?|search(?: for)?|list|browse|explore|recommend|suggest|compare)\b/i.test(text) &&
    /\b(?:projects?|properties|homes?|apartments?|villas?|townhouses?|developers?|districts?|areas?|communities|neighbou?rhoods?)\b/i.test(text);
  if (explicitlySearching) return true;

  // An assistant/company/founder discussion is not a project/entity lookup.
  // These are subjects, not sample questions or authored answers.
  if (/\b(?:prima|primadom|thredeesh|founder|creator|ceo)\b/i.test(text)) {
    return false;
  }

  // Named-entity introductions keep their existing catalog + D4/D5 checks.
  // Only the subject is examined: "Can you tell me about Passo" still works,
  // but "tell me about your background" does not do developer discovery.
  const intro = text.match(
    /^(?:(?:can|could|would) you (?:please )?)?(?:tell me (?:more )?about|what can you tell me about|give me an overview of|describe|explore|find|show me)\s+(.+?)\s*[.!?]*$/i
  );
  const subject = String(intro?.[1] || text).trim();
  if (/\b(?:i|me|my|mine|we|us|our|you|your|yours|he|him|his|she|her|they|them|their|this|that|it)\b/i.test(subject)) {
    return false;
  }

  // Open questions are for Core/Persona unless a specific property fact or
  // search capability is expressed. No question/answer phrase whitelists.
  if (!intro && /^(?:who|what|why|how|when|where|which|can|could|would|should|does|do|did|is|are|will)\b/i.test(text)) {
    return /\b(?:projects?|properties|apartments?|villas?|townhouses?|developers?|districts?|areas?|prices?|handover|payment|availability)\b/i.test(text);
  }

  const candidate = primaCatalogCandidateV1(text);
  if (!candidate || candidate.split(/\s+/).length > 7) return false;

  // Bare entity names stay eligible; arbitrary sentences without an entity
  // lookup structure do not trigger network preflight.
  if (intro) return true;
  const words = candidate.split(/\s+/);
  return words.length <= 4 && (words.length === 1 || words.every(
    word => /^[A-Z][a-z0-9.'&-]*$/.test(word) || /^(?:the|of|and|at|in)$/i.test(word)
  ));
}

function primaCatalogCandidateV1(message) {
  const text = String(message || "")
    .trim()
    .replace(
      /^(?:find|show me|search for|tell me(?: more)? about|what can you tell me about|give me an overview of|describe)\s+/i,
      ""
    )
    // D3_EXACT_PROJECT_PROFILE_V7: remove only a single-entity profile
    // presentation request, never a real second task or an entity name.
    // Identity still requires ONE exact verified catalog match.
    .replace(
      /\s+and\s+(?:show(?:\s+me)?|give\s+me)\s+(?:its|the)\s+(?:project\s+)?(?:profile|overview|details)\s*[.!?]*$/i,
      ""
    )
    .replace(/[.!?]+$/, "")
    .trim();

  if (
    text.length < 2 ||
    text.length > 110 ||
    !/^[\p{L}\p{N}&'’.\- ]+$/u.test(text) ||
    /^(?:hello|hi|yes|no|ok|okay|thanks|thank you|skip)$/i.test(text) ||
    /^(?:apartments?|villas?|townhouses?|developers?|districts?|areas?|projects?|properties)\b/i.test(text) ||
    /\b(?:under|below|above|budget|bedrooms?|looking for|how many|aed)\b/i.test(text)
  ) return null;

  return text;
}

async function primaCatalogProjectsV1() {
  if (!primaCatalogPromiseV1) {
    primaCatalogPromiseV1 = fetch(
      "https://primadom.ai/search/project-projections-v3/en.json"
    )
      .then(response => {
        if (!response.ok) {
          throw new Error("Project catalog HTTP " + response.status);
        }
        return response.json();
      })
      .then(document => {
        const projects = [];
        const seen = new Set();

        const visit = value => {
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }

          if (!value || typeof value !== "object") return;

          if (
            value.entity_type === "project" &&
            typeof value.title === "string" &&
            typeof value.slug === "string" &&
            value.canonical_url ===
              "/en/projects/" + value.slug + "/" &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)
          ) {
            if (!seen.has(value.canonical_url)) {
              seen.add(value.canonical_url);
              projects.push(value);
            }
            return;
          }

          Object.values(value).forEach(child => {
            if (child && typeof child === "object") visit(child);
          });
        };

        visit(document);

        if (projects.length !== 2571) {
          throw new Error("Incomplete canonical project catalog");
        }

        return projects;
      })
      .catch(error => {
        console.warn("prima_catalog_unavailable", error);
        primaCatalogPromiseV1 = null;
        return [];
      });
  }

  return primaCatalogPromiseV1;
}

async function primaResolveCatalogProjectV1(message) {
  const candidate = primaCatalogCandidateV1(message);
  if (!candidate) return null;

  const wanted = primaCatalogNormalizeV1(candidate);
  const projects = await primaCatalogProjectsV1();

  const matches = projects.filter(project => {
    const title = primaCatalogNormalizeV1(project.title);
    const developer = primaCatalogNormalizeV1(project.developer);
    const district = primaCatalogNormalizeV1(project.district);

    return (
      wanted === title ||
      (developer && wanted === title + " by " + developer) ||
      (district && wanted === title + " " + district) ||
      (district && wanted === title + " in " + district)
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function primaCatalogProjectCardV1(project) {
  return {
    version: "EntityCardRefV1",
    entity_type: "project",
    slug: project.slug,
    canonical_url: project.canonical_url,
    gallery_1: project.gallery_1 || "",
    image_alt: project.image_alt || "",
    rank: 1,
    facts: {
      version: "ProjectCardFactsV1",
      title: project.title,
      price_display: project.price_display || "",
      developer: project.developer || "",
      district: project.district || ""
    }
  };
}


/*
  E43_RESOLVED_DISTRICT_D5_HANDOFF_V1

  The Worker has resolved "that district" into a
  named project-search query.

  Use that query with the existing D5 executor.
  No guessed location and no new search engine.
*/

/*
  F1_RECOMMENDATION_CATALOG_HANDOFF_V1

  Verified candidate retrieval only.
  No OpenAI call.
  No personalized ranking claims.
  Buyer-fit reasoning belongs to F2/F3.
*/
// F21_DYNAMIC_RECOMMENDATION_COUNT_1_TO_10_V1
// Counts projects, not bedrooms, budgets or unit measurements.
function primaF21RequestedRecommendationCountV1(query) {
  const text = String(query || "").trim();

  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  const projectCount = text.match(
    /\b(10|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?!(?:bedrooms?|beds?|br|bhk|million|aed|sqft|sqm|years?)\b)[a-z][a-z-]*\s+|\d+-bed(?:room)?s?\s+){0,6}(?:projects?|properties|homes?|apartments?|villas?|townhouses?|residences?|options?|recommendations?)\b/i
  );

  const directRequest = text.match(
    /\b(?:recommend|suggest|show(?:\s+me)?|find(?:\s+me)?|give(?:\s+me)?|list|pick|choose)\s+(?:me\s+)?(10|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:[?.!,]|$|\bfor\b|\bto\b))/i
  );

  const match = projectCount || directRequest;

  if (!match) return null;

  const token = match[1].toLowerCase();
  const number = words[token] || Number(token);

  return Number.isInteger(number) &&
    number >= 1 &&
    number <= 10
      ? number
      : null;
}

async function primaF1RecommendationCandidatesV1(request) {
  const query = String(request?.query || "").trim();
  const projects = await primaCatalogProjectsV1();

  if (!Array.isArray(projects) || projects.length !== 2571) {
    throw new Error("F1 verified project catalog unavailable");
  }

  const wantsDubai = /\bdubai\b/i.test(query);

  // F28_STRICT_RECOMMENDATION_GEOGRAPHY_V1
  // Reuse verified catalog geography.
  // No independent Search engine or external call.

  const f28GeoNorm = value =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const f28Emirates = [
    "dubai",
    "abu dhabi",
    "sharjah",
    "ajman",
    "fujairah",
    "ras al khaimah",
    "umm al quwain"
  ];

  const f28LocationMatch = query.match(
    /\b(?:in|within|across|throughout)\s+(.+?)(?=\s+(?:for|with|under|below|up\s+to|at\s+most)\b|[,.!?]|$)/i
  );

  const f28Place = f28LocationMatch
    ? f28GeoNorm(f28LocationMatch[1])
    : null;

  const f28Districts = [
    ...new Set(
      projects
        .map(project =>
          f28GeoNorm(
            project?.district ||
            project?.machine_district
          )
        )
        .filter(Boolean)
    )
  ]
    .filter(name => !f28Emirates.includes(name))
    .sort((a, b) => b.length - a.length);

  const f28District = f28Place
    ? f28Districts.find(name =>
        f28Place === name ||
        f28Place.startsWith(name + " ")
      ) || null
    : null;

  const f28Emirate = f28Place
    ? f28Emirates.find(name =>
        f28Place === name ||
        f28Place.startsWith(name + " ")
      ) || null
    : null;

  // Unknown explicit places must not silently broaden
  // to all projects in an emirate.
  const f28UnknownPlace =
    Boolean(f28Place) &&
    !f28District &&
    !f28Emirates.includes(f28Place);


  const wantsFamily =
    /\b(family|families|children|kids)\b/i.test(query);
  const wantsInvestment =
    /\b(invest|investor|investment)\b/i.test(query);
  const wantsResidential =
    /\b(residential|home|homes|living|family)\b/i.test(query);


  // F25_RECOMMENDATION_CONSTRAINT_ACCURACY_V1
  // Temporary catalog filtering, not project rating.
  const propertyMatch = query.match(
    /\b(apartments?|villas?|townhouses?|penthouses?|duplex(?:es)?)\b/i
  );

  const explicitType = propertyMatch
    ? (
        /^apart/i.test(propertyMatch[1]) ? "apartment" :
        /^villa/i.test(propertyMatch[1]) ? "villa" :
        /^townhouse/i.test(propertyMatch[1]) ? "townhouse" :
        /^penthouse/i.test(propertyMatch[1]) ? "penthouse" :
        "duplex"
      )
    : null;

  const budgetMatch = query.match(
    /\b(?:under|below|up\s+to|at\s+most|within|max(?:imum)?)\s+(?:a\s+)?(?:budget\s+(?:of\s+)?)?(?:AED\s*)?([\d,.]+)\s*(million|millions|m|thousand|k)?\b/i
  );

  const maxPriceAed = (() => {
    if (!budgetMatch) return null;

    const amount = Number(
      budgetMatch[1].replace(/,/g, "")
    );

    const unit = String(
      budgetMatch[2] || ""
    ).toLowerCase();

    const factor =
      /^(million|millions|m)$/.test(unit)
        ? 1000000
        : /^(thousand|k)$/.test(unit)
          ? 1000
          : 1;

    const value = Math.round(amount * factor);

    return Number.isFinite(value) && value > 0
      ? value
      : null;
  })();

  // F27_STRICT_UNDER_BUDGET_V1
  // "under/below" is exclusive;
  // "up to/at most" remains inclusive.
  const f27StrictlyUnderBudget =
    Boolean(
      budgetMatch &&
      /^(?:under|below)\b/i.test(
        budgetMatch[0].trim()
      )
    );

  const requestedCount =
    primaF21RequestedRecommendationCountV1(query);

  const toolCount = Number(request?.requested_count);
  const limit = Number.isInteger(toolCount) && toolCount >= 1 && toolCount <= 10
    ? toolCount
    : (requestedCount ?? 3);

  // F211_RECOMMENDATION_BEDROOM_CONSTRAINT_V1
  // Explicit bedroom count, not recommendation count.
  const f211BedroomWords = {
    one: 1, two: 2, three: 3, four: 4,
    five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10
  };

  const f211BedroomMatch = query.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*[-\s]?\s*(?:bed(?:room)?s?|br|bhk)\b/i
  );

  const f211Bedrooms = f211BedroomMatch
    ? (
        f211BedroomWords[
          f211BedroomMatch[1].toLowerCase()
        ] || Number(f211BedroomMatch[1])
      )
    : null;

  // Interpret explicitly declared PROJECT unit formats.
  // Not evidence of unit-level availability or prices.
  const f211CatalogBedroomCounts = project => {
    const raw = String(
      project?.machine_units ||
      project?.units ||
      ""
    ).trim();

    const counts = new Set();

    if (
      !/(?:\b(?:br|bedrooms?|beds?|bhk)\b|\dbr\b)/i
        .test(raw)
    ) {
      return counts;
    }

    const normalized = raw.replace(
      /[\u2012-\u2015]/g,
      "-"
    );

    for (const part of normalized.split(/[|,;/·&+]/)) {
      const match = part.trim().match(
        /^(\d{1,2})(?:\s*(?:-|to)\s*(\d{1,2}))?\s*(?:br|bedrooms?|beds?|bhk)?$/i
      );

      if (!match) continue;

      const first = Number(match[1]);
      const last = match[2] !== undefined
        ? Number(match[2])
        : first;

      if (
        first < 1 || last > 10 ||
        first > last
      ) continue;

      for (let n = first; n <= last; n++) {
        counts.add(n);
      }
    }

    return counts;
  };


  const eligible = projects.filter(project => {
    if (!project?.slug || !project?.canonical_url) {
      return false;
    }

    // F210_RECOMMENDATION_PRICE_BUDGET_INTEGRITY_V1
    // Purchase-price sanity gate, NOT a market valuation.
    // Extremely low catalog figures are unverified
    // and must not qualify as property purchase prices.
    const f210Price = Number(project.price_amount);

    if (
      Number.isFinite(f210Price) &&
      f210Price > 0 &&
      f210Price < 100000
    ) {
      return false;
    }


    const emirate = String(
      project.machine_emirate || ""
    ).toLowerCase();

    const propertyType = String(
      project.machine_property_type ||
      project.property_type ||
      ""
    ).toLowerCase();

    const features = Array.isArray(project.features)
      ? project.features.map(v => String(v).toLowerCase())
      : [];

    if (wantsDubai && emirate !== "dubai") {
      return false;
    }

    if (f28UnknownPlace) {
      return false;
    }

    if (
      f28Emirate &&
      f28GeoNorm(project.machine_emirate) !==
        f28Emirate
    ) {
      return false;
    }

    if (
      f28District &&
      f28GeoNorm(
        project.district ||
        project.machine_district
      ) !== f28District
    ) {
      return false;
    }

    if (wantsFamily && !features.includes("family")) {
      return false;
    }

    if (
      wantsInvestment &&
      !wantsFamily &&
      !features.includes("investment")
    ) {
      return false;
    }

    if (
      wantsResidential &&
      !/(apartment|villa|townhouse|penthouse|duplex)/.test(
        propertyType
      )
    ) {
      return false;
    }

    if (
      explicitType &&
      !propertyType.includes(explicitType)
    ) {
      return false;
    }

    if (
      f211Bedrooms !== null &&
      !f211CatalogBedroomCounts(project).has(
        f211Bedrooms
      )
    ) {
      return false;
    }


    if (maxPriceAed !== null) {
      const startingPrice = Number(project.price_amount);

      if (
        !Number.isFinite(startingPrice) ||
        startingPrice <= 0 ||
        (
          f27StrictlyUnderBudget
            ? startingPrice >= maxPriceAed
            : startingPrice > maxPriceAed
        )
      ) {
        return false;
      }
    }

    return true;
  });

  // Technical completeness ordering only, NOT personalized
  // recommendation ranking.
  const completeness = project =>
    Number(
      Number.isFinite(Number(project.price_amount)) &&
      Number(project.price_amount) > 0
    ) +
    Number(Boolean(project.district)) +
    Number(Boolean(project.developer)) +
    Number(Boolean(project.gallery_1)) +
    Number(Boolean(project.handover));

  eligible.sort((a, b) =>
    (
      maxPriceAed !== null
        ? Number(b.price_amount) - Number(a.price_amount)
        : 0
    ) ||
    completeness(b) - completeness(a) ||
    String(a.canonical_url).localeCompare(
      String(b.canonical_url)
    )
  );

  // MEM18 — Exclude only Worker-verified shortlist/rejection decisions.
  // Apply exclusions BEFORE limiting F1 to the requested three cards;
  // filtering after selection silently produces too few alternatives.
  const excluded = new Set(
    Array.isArray(request?.exclude_project_slugs)
      ? request.exclude_project_slugs
          .filter(slug => typeof slug === "string" &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
          .slice(0, 100)
      : []
  );
  const selected = eligible
    .filter(project => !excluded.has(project.slug))
    .slice(0, limit);

  const results = selected.map((project, index) => ({
    ...project,
    rank: index + 1,
    project_id: project.slug,
    url_path: project.canonical_url,
    card: {
      ...primaCatalogProjectCardV1(project),
      rank: index + 1
    }
  }));

  console.info("F1_RECOMMENDATION_CANDIDATES", {
    matched: eligible.length,
    selected: results.length,
    source: "project-projections-v3/en.json"
  });

  return {
    version: "SearchContextV1",
    language: "en",
    source: "prima_f1_verified_project_catalog_v1",
    entity_type: "project",
    state: results.length ? "results" : "empty",
    query,
    filters: {
      emirate:
        f28Emirate || (wantsDubai ? "Dubai" : null),
      district: f28District || null,
      family: wantsFamily,
      investment: wantsInvestment,
      residential: wantsResidential,
      property_types: explicitType ? [explicitType] : [],
      bedrooms:
        f211Bedrooms !== null
          ? [f211Bedrooms]
          : [],
      bedroom_evidence_scope:
        f211Bedrooms !== null
          ? "project_catalog_formats_only"
          : null,
      budget: maxPriceAed !== null
        ? { max_aed: maxPriceAed }
        : null
    },
    result_count: results.length,
    requested_count: limit,
    current_batch_offset: 0,
    next_offset: null,
    results,
    f1_candidate_retrieval_only: true
  };
}

function primaE43ResolvedDistrictQueryV1(message, response) {
  const original = String(message || "").trim();
  const query = String(response?.query || "").trim();

  const contextual =
    /^(?:show(?:\s+me)?|find|list)(?:\s+(?:some|all|available))?\s+projects\s+in\s+(?:that|this|the)\s+(?:district|area|neighbou?rhood|community)\s*[?.!]*$/i
      .test(original);

  const named = query.match(
    /^(?:show(?:\s+me)?|find|list)\s+projects\s+in\s+([a-z0-9][a-z0-9 .,'&-]{1,100})\s*[?.!]*$/i
  );

  if (
    !contextual ||
    response?.version !== "PrimaToolRequestV1" ||
    response?.action !== "search_projects" ||
    response?.entity_type !== "project" ||
    response?.route !== "property_search" ||
    !named ||
    query.toLowerCase() === original.toLowerCase() ||
    /^(?:that|this|the)\s+(?:district|area|neighbou?rhood|community)$/i
      .test(named[1].trim())
  ) {
    return null;
  }

  return query;
}


// E44_DISTRICT_UX_CORRECTED_V1
// Text-only presentation helpers.
// Never modify SearchContext, ranking, cards or pagination.

function primaE44DistrictNameV1(batch) {
  const slug = String(
    batch?.filters?.district || ""
  ).trim();

  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) return "";

  const fromResults = String(
    batch?.results?.find(item =>
      typeof item?.district === "string" &&
      item.district.trim()
    )?.district || ""
  ).trim();

  const normalized = value =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (
    fromResults &&
    normalized(fromResults) === slug
  ) {
    return fromResults;
  }

  return slug
    .split("-")
    .map(word =>
      word.charAt(0).toUpperCase() +
      word.slice(1)
    )
    .join(" ");
}

function primaE44ResultCopyV1(text, batch) {
  const original = String(text || "");

  if (
    batch?.version !== "SearchContextV1"
  ) return original;

  const name = primaE44DistrictNameV1(batch);

  if (!name) return original;

  let revised = original.replace(
    /\bthat district\b/gi,
    name
  );

  const total = Number(batch.result_count);

  if (
    Number.isSafeInteger(total) &&
    total >= 0
  ) {
    revised = revised.replace(
      /\bHere are the first (\d+) of (\d+)\./gi,
      (match, shown, reported) =>
        Number(shown) === total &&
        Number(reported) === total
          ? `Here are all ${total}.`
          : match
    );
  }

  return revised;
}

function primaE44ProjectCountV1(area, profile) {
  const candidates = [
    profile?.project_count,
    profile?.projects_count,
    profile?.total_projects,
    profile?.projects_total,
    profile?.projectCount,
    profile?.stats?.project_count,
    area?.project_count,
    area?.projects_count,
    area?.total_projects,
    area?.projects_total,
    area?.projectCount
  ];

  const counts = candidates
    .filter(value =>
      typeof value === "number" ||
      (
        typeof value === "string" &&
        /^\d+$/.test(value.trim())
      )
    )
    .map(Number)
    .filter(value =>
      Number.isSafeInteger(value) &&
      value >= 0
    );

  if (!counts.length) return null;

  if (
    counts.some(count =>
      count !== counts[0]
    )
  ) return null;

  return counts[0];
}

function isToolRequest(
  data
) {
  return (
    data?.version ===
      "PrimaToolRequestV1" ||
    data?.response_type ===
      "tool_request"
  );
}


// F213_MULTI_ENTITY_RECOMMENDATION_V1
// Parse recommendation intent only; D4/D5 remain the search owners.
function primaF213EntityIntentV1(value) {
  const q = String(value || "").trim();
  if (!/^(?:please\s+)?(?:recommend|suggest)\b/i.test(q)) return null;
  const hit = q.match(/\b(developers?|districts?|areas|neighbou?rhoods|communities)\b/i);
  if (!hit) return null;
  if (/\bprojects?\b/i.test(q)) return null;
  const type = /^develop/i.test(hit[1]) ? "developer" : "district";
  const prefix = q.slice(0, hit.index);
  const words = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const number = prefix.match(/\b(10|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  const count = number ? (words[number[1].toLowerCase()] || Number(number[1])) : 3;
  const suffix = q.slice(hit.index + hit[0].length).replace(/[.!?]+$/, "").trim();
  const searchQuery = (type === "developer" ? "Find developers" : "Show districts") +
    (suffix ? " " + suffix : "");
  return {type, count, searchQuery, query:q};
}

async function send() {
  const value =
    input.value.trim();

  const f213Intent = primaF213EntityIntentV1(value);
  const entityPreflightAllowed = primaNeedsEntityPreflightV1(value);

  if (
    !value ||
    state.busy ||
    state.restoreBlocked
  ) {
    return;
  }

  state.turnSequence += 1;

  const turnId =
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : (
          "turn_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 12)
        );

  const turnSeq =
    state.turnSequence;

  const pendingSearchContext =
    state.pendingSearchContext;

  state.pendingSearchContext =
    null;

  const searchContextForTurn =
    pendingSearchContext ||
    (
      state.searchContext &&
      (
        shouldCarrySearchContext(value) ||
        /\b(?:first|second|third)\s+(?:one|project|developer|district|area|option)\b/i.test(
          String(value || "")
        )
      )
        ? state.searchContext
        : null
    );

  // D6_RETURN_PREVIOUS_SEARCH_V1
  const d6ReturnPreviousSearchRequested =
    d6ReturnPreviousSearchIntentV1(value, state.searchContext) &&
    state.searchContext?.version === "SearchContextV1" &&
    state.searchContext?.entity_type === "project" &&
    typeof state.d6PrepareD5ResumeV10 === "function";

  createUserTurn(
    value
  );

  input.value =
    "";

  scrollToBottom();

  const assistant =
    createAssistantTurn(
      true
    );

  scrollToBottom();

  setBusy(
    true
  );

  try {
    // C_D_RESUME_VERIFIED_D5_V10: fetch a verified next batch before
    // asking Block C to persist "resume". Fail closed for stale sessions.
    const d6PreparedResumeV10 = d6ReturnPreviousSearchRequested
      ? await state.d6PrepareD5ResumeV10()
      : null;
    if (d6ReturnPreviousSearchRequested && !d6PreparedResumeV10) {
      await revealText(assistant.message,
        "I can't verify the next batch of your previous search. Please reopen the search to continue.");
      return;
    }

    const preflightStartedAt = performance.now();
    // D5_GEO_PARALLEL_V1
    // Start verified emirate discovery before the main conversation request.
    // The conversation request itself remains unchanged.
    const d5GeoIntent =
      /^(?:(?:show(?: me)?|find|list|browse)\s+)?(?:all\s+)?(?:the\s+)?(?:districts|areas|neighbou?rhoods|communities)\s+in\s+(dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|uaq|rak)\s*[.!?]?$/i
        .test(value);

    // D5 named entity identity takes precedence over qualitative traits.
    // Example: "Island" within a verified place name is not a waterfront filter.
    const d5NamedCandidate = primaD5NamedDistrictCandidateV3(value);

    // D5_SMART_UI_ROUTING_V1
    const d5SmartIntent =
      !d5NamedCandidate &&
      /\b(?:districts?|areas?|neighbou?rhoods?|communities)\b/i.test(value) &&
      /\b(?:family|families|children|child|kids|schools|invest|investment|investing|investors?|income|waterfront|beachfront|beach|coastal|seaside|island|green|parks?|nature|landscaped|quiet|calm|peaceful|tranquil)\b/i.test(value) &&
      !/\b(?:projects?|developers?|luxury|premium|affordable|cheap|expensive|budget|aed|million|yield|roi|under|below|up to)\b/i.test(value);

    // D5_BUDGET_PARALLEL_V1
    const d5BudgetIntent =
      /\b(?:districts?|areas?|communities|neighbou?rhoods?)\b/i.test(value) &&
      /\baed\b/i.test(value) &&
      /\b(?:under|below|up to|within|max|maximum)\b/i.test(value);

    // D5_DISCUSS_PARALLEL_V1
    // Verify named district discussions alongside conversation setup.
    // Preserve the original conversation request and fallback contract.
    const d5DiscussIntent =
      /^tell me (?:more )?about\s+.{2,90}\s*[.!?]?$/i.test(value) &&
      entityPreflightAllowed;

    // D6_CONTEXTUAL_DEVELOPER_DISTRICT_V1
    // The prior SearchContext is the source of verified developer identity.
    const d6ContextFollowupQuery =
      d6ContextualDeveloperDistrictQueryV1(
        value,
        state.searchContext
      );

    // C_D_UNRESOLVED_REFERENCE_GUARD_V8:
    // Without a verified prior developer/district, do not send a
    // coreference-only refinement to broad D3 Search as a new query.
    // Ask for identities instead; never manufacture filters or results.
    const unresolvedDeveloperDistrictReference =
      /\b(?:same|previous|last|that|this)\s+(?:developer|builder)\b/i.test(value) &&
      /\b(?:(?:the\s+)?same|that|this|previous|last)\s+(?:district|area|community|neighbou?rhood)\b/i.test(value) &&
      /\b(?:projects?|properties|apartments?|villas?|townhouses?)\b/i.test(value) &&
      !d6ContextFollowupQuery;
    if (unresolvedDeveloperDistrictReference) {
      await revealText(assistant.message,
        "I need the previous developer and district to be verified before refining this search. Please name them so I can filter the projects accurately.");
      console.warn("c_d_unresolved_search_reference", {turn_seq: turnSeq});
      return;
    }

    // D5-13: Start verified cross-entity lookup in parallel.
    const d5CrossEntityIntent =
      isD5CrossDistrictIntentV1(value) ||
      Boolean(parseD5CrossProjectIntentV1(value)) ||
      Boolean(d6ContextFollowupQuery);

    const primaCatalogProject =
      entityPreflightAllowed
        ? await primaResolveCatalogProjectV1(value)
        : null;

    const d5GeoPromise =
      (entityPreflightAllowed && (f213Intent?.type === "district" || d5GeoIntent || d5SmartIntent || d5BudgetIntent ||
        d5DiscussIntent || d5CrossEntityIntent))
        ? tryD5DistrictRequestV1(f213Intent?.type === "district"
            ? f213Intent.searchQuery : (d6ContextFollowupQuery || value), null)
          .catch(error => {
            console.warn("d5_geo_lookup_failed", error);
            return null;
          })
      : null;

    // Avoid a second, irrelevant district-name lookup for emirate lists.
    const d5ShortPromise =
      !entityPreflightAllowed
        ? Promise.resolve(null)
        : d5NamedCandidate
          ? d5VerifyShortDistrictV2("Find " + d5NamedCandidate)
              .then(async result => {
                // A leading article may be part of a real name ("The Valley").
                // Verify the literal name first, then an article-free variant.
                if (!result && /^the\s+/i.test(d5NamedCandidate)) {
                  result = await d5VerifyShortDistrictV2(
                    "Find " + d5NamedCandidate.replace(/^the\s+/i, "")
                  );
                }
                return result || (
                  /\b(?:profile|overview|details)\b/i.test(value)
                    ? {mode:"named_not_found", name:d5NamedCandidate}
                    : null
                );
              })
              .catch(error => {
                console.warn("d5_named_registry_lookup_failed", error);
                return null;
              })
          : (f213Intent?.type === "district" || d5GeoIntent || d5SmartIntent || d5BudgetIntent ||
             d5DiscussIntent || d5CrossEntityIntent)
              ? Promise.resolve(null)
              : d5VerifyShortDistrictV2(value)
                  .catch(error => {
                    console.warn("d5_short_lookup_failed", error);
                    return null;
                  });

    const entityPreflightMs = Math.round(performance.now() - preflightStartedAt);
    let conversationId = null;
    let data = null;
    let started = performance.now();

    try {
    conversationId =
      await ensureConversation({
        initiator:
          state.greetingShown
            ? "prima"
            : "user"
      });

    started =
      performance.now();

    data =
      await postJson(
        "/api/prima/message",
        {
          conversation_id:
            conversationId,

          user: {
            // Canonicalize ONLY an exact, unique catalog project match.
            // "Tell me about Passo by Beyond" must resolve like a profile
            // request; no model needed to strip a verified developer suffix.
            message: entityPreflightAllowed
              ? await d4ResolveBareDeveloperIntent(
                  primaCatalogProject
                    ? "Tell me about " + primaCatalogProject.title
                    : value
                )
              : value
          },

          visitor_id:
            getPrimadomAnalyticsContext()
              .visitor_id,

          session_id:
            getPrimadomAnalyticsContext()
              .session_id,

          onboarding: {
            first_user_turn:
              state
                .firstUserTurnPending,

            awaiting_name:
              state
                .awaitingName
          },

          ...(
            (d6PreparedResumeV10?.searchContext || searchContextForTurn)
              ? {
                  search_context:
                    d6PreparedResumeV10?.searchContext || searchContextForTurn
                }
              : {}
          ),

          ...CONTEXT,

          turn: {
            version:
              "ConversationTurnV1",
            turn_id:
              turnId,
            turn_seq:
              turnSeq,
            // The verified page has already been fetched by D5.
            // Worker still recognizes/persists the Block C resume move.
            phase:
              d6PreparedResumeV10 ? "tool_continuation" : "initial"
          }
        }
      );

    } catch (d5TransportError) {
      // Never invent search results and never bypass the
      // conversation request when it is available.
      const verifiedD5 = d5GeoPromise
        ? await d5GeoPromise
        : null;

      if (!verifiedD5) {
        throw d5TransportError;
      }

      console.warn(
        "d5_verified_search_conversation_unavailable",
        d5TransportError
      );

      // Search can still be displayed. This does NOT assert
      // that the failed conversation turn was persisted.
      data = {
        route: "d5_verified_search_fallback",
        response_type: "d5_verified_search",
        meta: {
          used_openai: false,
          used_search: true,
          conversation_persistence_unconfirmed: true
        }
      };
    }

    // C_D_RESUME_VERIFIED_D5_V10: no local-only return and no duplicate
    // cards. Commit D5's next batch only after the Worker has persisted
    // the authoritative resumed conversation and matching result offset.
    if (d6PreparedResumeV10) {
      const ok = data?.version === "ResponseContractV1" &&
        data?.route === "property_search" &&
        data?.response_type === "search_results" &&
        data?.meta?.conversation_move?.move_type === "resume" &&
        data?.meta?.conversation_move?.reason ===
          "explicit_resume_to_suspended_thread" &&
        data?.search_pagination?.current_offset === d6PreparedResumeV10.offset &&
        Array.isArray(data?.cards) &&
        data.cards.length === d6PreparedResumeV10.searchContext.results.length -
          d6PreparedResumeV10.offset &&
        data.cards.every((card, i) =>
          card.slug === d6PreparedResumeV10.searchContext.results[
            d6PreparedResumeV10.offset + i
          ]?.slug
        ) &&
        data?.meta?.conversation_state?.continuity_references
          ?.active_search_context?.current_batch_offset ===
          d6PreparedResumeV10.offset;
      if (!ok) {
        console.error("c_d_resume_contract_mismatch", data);
        await revealText(assistant.message,
          "I couldn't confirm the resumed search position. No additional cards were displayed.");
        return;
      }
      await revealText(assistant.message, data.answer);
      d6PreparedResumeV10.commit();
      state.firstUserTurnPending = false;
      state.awaitingName = Boolean(data.meta?.name_onboarding_requested);
      console.info("c_d_resume_verified", {
        offset: d6PreparedResumeV10.offset,
        openai_tokens: data.meta?.total_openai_tokens ?? null
      });
      return;
    }

    const latency =
      Math.round(
        performance.now() -
        started
      );

    console.log(
      "Prima response:",
      {
        latency_ms:
          latency,

        entity_preflight_ms: entityPreflightMs,
        entity_preflight_allowed: entityPreflightAllowed,

        route:
          data?.route,

        response_type:
          data?.response_type,

        used_openai:
          data?.meta
            ?.used_openai,

        used_search:
          data?.meta
            ?.used_search,

        data
      }
    );



    // The Worker is authoritative for Persona/Contact/off-topic. Never
    // reinterpret a completed conversational answer via D5 entity discovery.
    // Search tool requests and verified search routes retain their D5 paths.
    const workerConversationOnly = !isToolRequest(data) &&
      ["persona_question", "contact_intent", "unsupported", "off_topic"]
        .includes(data?.route);
    let d5District = null;
    if (!workerConversationOnly) {
      try {
        d5District = (await d5ShortPromise) ||
          (d5GeoPromise
            ? await d5GeoPromise
            : await tryD5DistrictRequestV1(d6ContextFollowupQuery || value, data));
      } catch (error) {
        console.warn("D5 lookup unavailable; leaving original route intact", error);
      }
    }

    // Typed Worker tool requests are authoritative for the result entity type.
    // Concurrent D5 discovery may match "area" + budget in a PROJECT query;
    // district lists must never replace an explicit Search V3 project request.
    // Retain verified D5 project contexts for existing cross-entity handoffs.
    if (
      data?.version === "PrimaToolRequestV1" &&
      data?.tool === "prima_search" &&
      data?.action === "search_projects" &&
      data?.entity_type === "project" &&
      d5District &&
      d5District.mode !== "projects" &&
      // An explicit district-directory request is authoritative even if
      // the Worker erroneously routed it as project search.
      !(d5GeoIntent && d5District.mode === "list")
    ) {
      console.info("prima_project_tool_ignores_d5_discovery", {
        discarded_mode: d5District.mode
      });
      d5District = null;
    }




    // A request for one district profile must never fall through to a
    // broad waterfront/family district list if Registry did not verify it.
    if (d5District?.mode === "named_not_found") {
      await revealText(assistant.message,
        "I couldn't verify the district '" + d5District.name +
        "' in the Primadom directory. Could you confirm the name?");
      return;
    }

    // E4.3 — D5 receives the resolved Worker query,
    // not the unresolved wording from the user.
    const e43DistrictQuery =
      !d5District
        ? primaE43ResolvedDistrictQueryV1(value, data)
        : null;

    if (e43DistrictQuery) {
      try {
        d5District = await tryD5DistrictRequestV1(
          e43DistrictQuery,
          data
        );

        console.info(
          "e43_district_handoff",
          {
            query: e43DistrictQuery,
            mode: d5District?.mode || null,
            results:
              d5District?.context?.result_count ?? null
          }
        );
      } catch (error) {
        console.warn(
          "E4.3 D5 resolved-query lookup failed:",
          error
        );
      }
    }

    // F213_RECOMMENDATION_ENTITY_HANDOFF_V1
    // Only verified D4/D5 rows; no new catalog, rank or model call.
    async function f213ComposeEntityV1(type, first, lookup) {
      const requested = f213Intent.count;
      const all = [];
      const seen = new Set();
      let batch = first;
      let offset = Number(batch?.current_batch_offset || 0);
      for (let page = 0; page < 4 && all.length < requested; page++) {
        if (!batch || !Array.isArray(batch.results)) break;
        for (const item of batch.results) {
          if (all.length >= requested) break;
          const slug = String(item?.slug || "");
          const url = String(item?.canonical_url || "");
          const prefix = type === "district" ? "/en/areas/" : "/en/developers/";
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
              url !== prefix + slug + "/" || seen.has(slug)) continue;
          seen.add(slug);
          const title = String(item.title || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
          if (!title || title.length > 120) continue;
          all.push({slug,title,canonical_url:url,
            matching_project_count:Number.isInteger(item.matching_project_count)
              ? item.matching_project_count : null});
        }
        if (batch.has_more !== true || !batch.results.length || all.length >= requested) break;
        offset += batch.results.length;
        batch = await lookup(offset);
      }
      const payload = {
        version:"RecommendationEntityContextV1", entity_type:type,
        requested_count:requested, source:type === "district" ? "D5" : "D4",
        query:value, search_query:f213Intent.searchQuery,
        search_mode:String(first?.search_mode || "").slice(0,40),
        emirate:String(first?.emirate || "").slice(0,50),
        criteria:Array.isArray(first?.criteria) ? first.criteria.slice(0,8).map(String) : [],
        results:all
      };
      const response = await postJson("/api/prima/message", {
        conversation_id:conversationId,
        user:{message:value},
        visitor_id:getPrimadomAnalyticsContext().visitor_id,
        session_id:getPrimadomAnalyticsContext().session_id,
        onboarding:{first_user_turn:state.firstUserTurnPending,
          awaiting_name:state.awaitingName},
        ...CONTEXT,
        recommendation_context:payload,
        turn:{version:"ConversationTurnV1",turn_id:turnId,
          turn_seq:turnSeq,phase:"tool_continuation"}
      });
      if (response?.version !== "ResponseContractV1" ||
          response?.route !== "recommendation") {
        throw new Error("F2.13 recommendation continuation contract mismatch");
      }
      return {response, payload};
    }

    function f213PostCardsQuestionV1(node, question) {
      if (!node || typeof question !== "string" || !question.trim()) return;
      const p = document.createElement("p");
      p.className = "prima-recommendation-refinement";
      p.textContent = question.trim();
      const style = window.getComputedStyle(assistant.message);
      for (const key of ["fontFamily","fontSize","fontWeight","lineHeight",
        "letterSpacing","color"]) p.style[key] = style[key];
      p.style.margin = "12px 0 8px";
      node.insertAdjacentElement("afterend", p);
    }

    // An unsupported district category request must not fall into Project Search.
    // F-V1 D5 interface: geography in a recommendation can be followed by
    // buyer-purpose wording. D5's existing emirate-list contract accepts
    // the geographic part; do not mistake that suffix for a district name.
    if (f213Intent?.type === "district" &&
        (!d5District || d5District.mode !== "list")) {
      const normalizedGeo = f213Intent.searchQuery.match(
        /^Show districts in (dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|umm al quwain)\s+for\s+(?:buying|purchasing)\s+(?:an?\s+)?(?:apartment|villa|townhouse|home|property)\s*$/i
      );
      if (normalizedGeo) {
        try {
          d5District = await tryD5DistrictRequestV1(
            "Show districts in " + normalizedGeo[1], data
          );
        } catch (error) {
          console.warn("F-V1 D5 verified geography handoff unavailable", error);
        }
      }
    }
    if (f213Intent?.type === "district" &&
        (!d5District || d5District.mode !== "list")) {
      await revealText(assistant.message,
        "I couldn't verify district results right now. Please try again.");
      return;
    }

    if (d5District?.mode === "choice") {
      const batch = d5District.data;
      assistant.message.style.color = "";

      const typing = revealText(
        assistant.message,
        `I found ${batch.result_count} districts matching "${d5District.name}". ` +
        "Which one did you mean?"
      );

      await renderD5DistrictListV1(batch, typing);
      return;
    }

    if (d5District?.mode === "list") {
      // F213_DISTRICT_RECOMMENDATION: D5 still owns cards and pagination.
      if (f213Intent?.type === "district" && data?.route === "recommendation" && isToolRequest(data)) {
        const first = d5District.data;
        if (!first.results.length) {
          await revealText(assistant.message,
            "I couldn't find matching districts in the current directory results. We can broaden your criteria.");
          return;
        }
        const q = f213Intent.searchQuery;
        const composed = await f213ComposeEntityV1("district",first,async offset => {
          const url = new URL("/__prima_d5_districts",API_BASE);
          url.searchParams.set("q",q);
          url.searchParams.set("offset",String(offset));
          const r = await fetch(url);
          if (!r.ok) throw new Error("F2.13 D5 continuation HTTP " + r.status);
          const next = await r.json();
          if (next?.version !== "DistrictDiscoveryV1" || !Array.isArray(next.results))
            throw new Error("F2.13 invalid D5 continuation");
          return next;
        });
        const count = composed.payload.results.length;
        const text = count ? composed.response.answer :
          "I couldn't find verified district matches for those conditions.";
        if (!count) { await revealText(assistant.message,text); return; }
        const before = new Set(dynamic.querySelectorAll(".prima-district-list"));
        await renderD5DistrictListV1(first,revealText(assistant.message,text),count);
        const newGrid = [...dynamic.querySelectorAll(".prima-district-list")]
          .find(node => !before.has(node));
        if (newGrid) f213PostCardsQuestionV1(newGrid,composed.response.follow_up);
        state.firstUserTurnPending = false;
        state.awaitingName = Boolean(composed.response?.meta?.name_onboarding_requested);
        console.info("F213_DISTRICT_RECOMMENDATION",{requested:f213Intent.count,verified:count,
          used_final_openai:composed.response?.meta?.used_final_openai});
        return;
      }
      // D5_SHARED_LOADING_AND_ACTIONS_V1
      const batch = d5District.data;

      try {
        assistant.message.style.color = "";

        // Start typing immediately, while cards load in parallel.
        const textReady = revealText(
          assistant.message,
          ["budget", "combined", "developer_district"]
            .includes(batch.search_mode)
            ? (() => {
                const location = batch.emirate
                  ? ` in ${batch.emirate}`
                  : " across the UAE";

                const type = batch.filters?.property_type
                  ? ` for ${batch.filters.property_type} properties`
                  : "";

                const amount = Number(batch.filters?.budget_max);
                const budgetText =
                  batch.filters?.budget_max != null &&
                  Number.isFinite(amount) && amount > 0
                  ? ` within a budget of AED ${amount.toLocaleString("en-US")}`
                  : "";

                const traits = ["combined", "developer_district"]
                  .includes(batch.search_mode) &&
                  Array.isArray(batch.criteria) &&
                  batch.criteria.length
                    ? ` aligned with your ${batch.criteria.join(" and ")} preferences`
                    : "";

                const developerText =
                  batch.search_mode === "developer_district" &&
                  batch.filters?.developer
                    ? " by " + batch.filters.developer
                    : "";

                if (!batch.result_count) {
                  return "I couldn't find districts with matching catalog projects" +
                    location + type + budgetText + traits +
                    ". We can broaden one of these criteria.";
                }

                return `I found ${batch.result_count} districts${location}` +
                  ` with ${batch.matching_project_count_total} matching catalog projects` +
                  developerText + type + budgetText + traits + ". " +
                  "These matches use project-level catalog prices, " +
                  "not verified prices or availability for individual units. " +
                  "Explore the district cards below.";
              })()
            : batch.search_mode === "intelligent"
              ? (() => {
                // D5_ADVISORY_SUMMARY_V1
                // Summarize matching criteria without repeating card titles.
                const descriptions = {
                  family: "family living",
                  investment: "investment considerations",
                  waterfront: "waterfront living",
                  green: "green surroundings",
                  quiet: "a quieter lifestyle"
                };

                const priorities = (batch.criteria || [])
                  .map(key => descriptions[key])
                  .filter(Boolean);

                const preferences = priorities.length < 2
                  ? (priorities[0] || "your preferences")
                  : priorities.slice(0, -1).join(", ") +
                    " and " + priorities[priorities.length - 1];

                const location = batch.emirate
                  ? `in ${batch.emirate}`
                  : "across the UAE";

                if (!batch.result_count) {
                  return `I couldn't find district profiles ${location} ` +
                    `matching all your preferences for ${preferences}. ` +
                    "Try broadening the location or adjusting one of " +
                    "your lifestyle priorities.";
                }

                return `I found ${batch.result_count} districts ${location} ` +
                  `with characteristics aligned with ${preferences}. ` +
                  "I considered the available Primadom district profiles, " +
                  "lifestyle characteristics and buyer-fit signals. " +
                  "Explore the matching areas below to compare their " +
                  "profiles and linked projects. " +
                  "Current project prices, availability and investment " +
                  "returns require separate verification.";
              })()
            : batch.emirate
              ? `I found ${batch.result_count} districts in ${batch.emirate} ` +
                "in the Primadom district directory. " +
                "These areas match your requested location. " +
                `Here are the first ${batch.results.length} in alphabetical order. ` +
                "You can explore each district's profile and linked projects."
              : `I found ${batch.result_count} districts in the Primadom directory. ` +
                "Here are the first three in alphabetical order."
        );

        // Mount cards and actions only after the text is ready.
        await renderD5DistrictListV1(batch, textReady);
      } catch (error) {
        console.error("d5_list_render_failed", error);
        assistant.message.textContent =
          "I couldn't display the district results. Please try again.";
        assistant.message.style.color = "";
      }
      return;
    }

    // D5_NAMED_DISTRICT_TOOL_CONTINUATION_V4
    // Complete the very same user turn via the existing Worker contract.
    // No extra lookup or answer synthesis. Page attribution remains intact;
    // only the verified conversational entity changes for this turn.
    function startD5NamedDistrictContinuationV4(area) {
      if (!isToolRequest(data)) return null;
      const verified = primaD5VerifiedNamedDistrictContextV4(area, value);
      if (!verified) {
        console.error("d5_named_district_handoff_invalid_registry_identity");
        return Promise.resolve({error: "invalid_verified_district_identity"});
      }
      const completion = postJson("/api/prima/message", {
        conversation_id: conversationId,
        user: {message: value},
        visitor_id: getPrimadomAnalyticsContext().visitor_id,
        session_id: getPrimadomAnalyticsContext().session_id,
        onboarding: {
          first_user_turn: state.firstUserTurnPending,
          awaiting_name: state.awaitingName
        },
        ...CONTEXT,
        // Unlike the physical page, this is a verified dialog referent.
        entity: {...CONTEXT.entity, primary_type: "district",
          primary_slug: verified.results[0].slug,
          secondary_type: null, secondary_slug: null},
        search_context: verified,
        turn: {version: "ConversationTurnV1", turn_id: turnId,
          turn_seq: turnSeq, phase: "tool_continuation"}
      }).then(final => {
        if (final?.version !== "ResponseContractV1" ||
            final?.turn?.phase !== "tool_continuation" ||
            final?.turn?.turn_id !== turnId ||
            final?.turn?.turn_seq !== turnSeq) {
          throw new Error("D5 named district continuation contract mismatch");
        }
        console.info("d5_named_district_tool_continuation", {
          route: final.route,
          worker_ms: final.meta?.worker_total_ms ?? null,
          openai_calls: final.meta?.openai_calls_attempted ?? null,
          openai_tokens: final.meta?.total_openai_tokens ?? null,
          openai_usage_unknown: final.meta?.openai_usage_unknown ?? null
        });
        return {final};
      });
      // Attach rejection handling immediately while the verified card renders.
      return completion.catch(error => ({error}));
    }

    function completeD5NamedDistrictUIV4(result) {
      if (!result) {
        console.warn("d5_named_district_persistence_unconfirmed", "initial Worker request unavailable");
      } else if (result.error) {
        console.error("d5_named_district_persistence_unconfirmed", result.error);
      } else {
        state.firstUserTurnPending = false;
        state.awaitingName = Boolean(result.final?.meta?.name_onboarding_requested);
      }
    }

    // D5_DISTRICT_DISCUSS_V1 — grounded district conversation.
    // D5_DISCUSS_LARGE_CARD_V1
    // Short typed description -> existing large card -> typed question.
    if (d5District?.mode === "discuss") {
      const area = d5District.district;
      const d5NamedDistrictCompletion = startD5NamedDistrictContinuationV4(area);
      let profile = null;

      try {
        const url = new URL("/__prima_d5_districts", API_BASE);
        url.searchParams.set("district", area.slug);
        url.searchParams.set("mode", "profile");

        const response = await fetch(url);

        if (response.ok) {
          const result = await response.json();

          if (result?.version === "DistrictCardProfileV1") {
            profile = result;
          }
        }
      } catch (error) {
        console.warn("d5_discuss_profile_unavailable", error);
      }

      const name = String(area.title || "this district");
      const city = String(
        profile?.city || area.emirate || ""
      ).trim();

      const subtitle = String(profile?.subtitle || "")
        .replace(/\s+/g, " ")
        .trim();

      const sentences =
        subtitle.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];

      const description = sentences
        .slice(0, 2)
        .join(" ")
        .trim();

      const introduction = description
        ? (
            description.toLowerCase()
              .startsWith(name.toLowerCase())
              ? description
              : name + " — " + description
          )
        : (
            "Here is the Primadom profile for " +
            name + (city ? " in " + city : "") + "."
          );

      // 1. Typed introduction.
      assistant.message.style.color = "";
      await revealText(assistant.message, introduction);

      // 2. Existing large single-district card.
      await renderD5DistrictCardV1(area, profile);

      // 3. Typed follow-up BELOW the card.
      const followup = document.createElement("p");

      followup.className = "prima-d5-discuss-followup";

      followup.style.cssText =
        "margin:16px 0 4px;" +
        "font-size:14px;line-height:1.6;" +
        "color:rgba(255,255,255,.86)";

      dynamic.appendChild(followup);

      await revealText(
        followup,
        (() => {
          const projectCount =
            primaE44ProjectCountV1(area, profile);

          if (projectCount === 0) {
            return `There are currently no projects listed in ${name} in the Primadom catalog. Would you like to compare it with another district or ask an advisor?`;
          }

          if (projectCount > 0) {
            return "Would you like to explore projects in " +
              name +
              " or compare it with another district?";
          }

          // Unknown count: avoid claiming projects exist.
          return "Would you like to compare this district with another area or ask an advisor?";
        })()
      );

      scrollToBottom();
      completeD5NamedDistrictUIV4(d5NamedDistrictCompletion
        ? await d5NamedDistrictCompletion : null);
      return;
    }

    if (d5District?.mode === "district") {
      const area = d5District.district;
      const d5NamedDistrictCompletion = startD5NamedDistrictContinuationV4(area);
      let profile = null;

      try {
        const url = new URL("/__prima_d5_districts", API_BASE);
        url.searchParams.set("district", area.slug);
        url.searchParams.set("mode", "profile");

        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data?.version === "DistrictCardProfileV1") {
            profile = data;
          }
        }
      } catch (error) {
        console.warn("d5_district_summary_unavailable", error);
      }

      const subtitle = String(profile?.subtitle || "").trim();
      const name = String(area.title || "");

      const summary = subtitle
        ? (
            subtitle.toLowerCase().startsWith(name.toLowerCase())
              ? subtitle
              : `${name}: ${subtitle}`
          )
        : `Here is the Primadom profile for ${name}.`;

      await revealText(assistant.message, summary);
      await renderD5DistrictCardV1(area, profile);
      completeD5NamedDistrictUIV4(d5NamedDistrictCompletion
        ? await d5NamedDistrictCompletion : null);
      return;
    }

    // D5_13_DEVELOPER_CARDS_PAGINATION_V1
    // Short response, three real catalog-linked developer cards,
    // then Show 3 more. D4 is used only to verify directory links.
    if (d5District?.mode === "developers") {
      const group = d5District.data;
      const districtName = String(
        d5District.district?.title || "this district"
      );

      if (
        group?.version !== "DistrictDevelopersV1" ||
        !Array.isArray(group.results)
      ) {
        throw new Error("Invalid D5 developers contract");
      }

      const developers = group.results.filter(item =>
        item &&
        typeof item.name === "string" &&
        item.name.trim() &&
        Number.isInteger(item.project_count) &&
        item.project_count > 0
      );

      const total = developers.length;

      const intro = total
        ? (
            "I found " + total +
            " developers with catalog-listed projects in " +
            districtName +
            ". Here are the first " +
            Math.min(3, total) +
            " to explore."
          )
        : (
            "I couldn't find developers with linked projects in " +
            districtName + ". We can explore another district."
          );

      assistant.message.style.color = "";
      await revealText(assistant.message, intro);

      if (!total) return;

      // Isolated card styling; no D3 or D4 modifications.
      if (!document.getElementById("prima-d5-developer-grid-style")) {
        const style = document.createElement("style");
        style.id = "prima-d5-developer-grid-style";
        style.textContent = `
          .prima-d5-developer-grid {
            display:grid;
            grid-template-columns:repeat(3,minmax(0,1fr));
            gap:14px;
            margin-top:16px;
            align-items:stretch;
          }
          .prima-d5-developer-grid .prima-d5-developer-item {
            min-width:0;
          }
          @media(max-width:850px) {
            .prima-d5-developer-grid {
              grid-template-columns:repeat(2,minmax(0,1fr));
            }
          }
          @media(max-width:560px) {
            .prima-d5-developer-grid {
              grid-template-columns:minmax(0,1fr);
            }
          }
        `;
        document.head.appendChild(style);
      }

      let grid = document.createElement("div");
      grid.className = "prima-d5-developer-grid";
      dynamic.appendChild(grid);

      const toolbar = document.createElement("div");
      toolbar.style.cssText =
        "display:flex;gap:8px;flex-wrap:wrap;" +
        "margin:18px 0 8px";

      dynamic.appendChild(toolbar);

      const actionButton = (label, action, accented = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.className = "prima-d5-card-action";
        button.style.cssText =
          "display:inline-flex;align-items:center;" +
          "justify-content:center;min-height:32px;" +
          "padding:7px 12px;border-radius:999px;" +
          "font:inherit;font-size:11px;line-height:1.2;" +
          "white-space:nowrap;cursor:pointer;" +
          (accented
            ? "background:#493028;color:#f7e7df;" +
              "border:1px solid #89513b;"
            : "background:#282625;color:#ddd8d4;" +
              "border:1px solid rgba(255,255,255,.16);");

        button.addEventListener("click", event => {
          event.stopPropagation();
          if (!state.busy) action();
        });

        return button;
      };

      const exact = value => String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

      // D5_13_STABLE_DEVELOPER_LINKS_V1
      // Verify a canonical D4 link once per visible card batch.
      const resolveVerifiedD4Url = async name => {
        try {
          const batch = await fetchD4DeveloperBatch(
            "Find " + name, 0
          );

          const found = (batch?.results || []).filter(item =>
            exact(item.title) === exact(name) &&
            /^\/en\/developers\/[a-z0-9-]+\/$/.test(
              String(item.canonical_url || "")
            )
          );

          if (found.length !== 1) return null;

          return new URL(
            found[0].canonical_url,
            "https://primadom.ai"
          ).href;
        } catch (error) {
          console.warn(
            "d5_developer_directory_link_unavailable",
            name, error
          );
          return null;
        }
      };

      const renderDeveloper = (developer, verifiedUrl = null) => {
        const name = developer.name.trim();
        const count = developer.project_count;

        const card = document.createElement("article");
        card.className =
          "card prima-d5-developer-item";
        card.style.cssText =
          "overflow:hidden;border-radius:18px;" +
          "height:auto;min-height:0;";

        // Neutral identity presentation.
        // Do not invent a developer photograph or logo.
        const media = document.createElement("div");
        media.style.cssText =
          "height:174px;display:flex;" +
          "align-items:center;justify-content:center;" +
          "background:rgba(255,255,255,.035);" +
          "border-bottom:1px solid rgba(255,255,255,.07);";

        // D5_13_DEVELOPER_CARD_CLEANUP_V1
        // Empty media placeholder until real photos are added.


        const body = document.createElement("div");
        body.style.cssText =
          "padding:14px;display:grid;gap:9px;";

        const heading = document.createElement("strong");
        heading.textContent = name;
        heading.style.cssText =
          "font-size:15px;line-height:1.35;";

        const location = document.createElement("span");
        location.textContent = districtName + ", UAE";
        location.style.cssText =
          "font-size:12px;color:rgba(255,255,255,.60);";



        const actions = document.createElement("div");
        actions.style.cssText =
          "display:flex;gap:7px;flex-wrap:wrap;";

        actions.appendChild(actionButton("Discuss", () => {
          input.value = "Tell me about " + name;
          send();
        }, true));

        actions.appendChild(actionButton(
          count.toLocaleString("en-US") +
          (count === 1 ? " Project" : " Projects"),
          () => {
          input.value =
            "Projects by " + name + " in " + districtName;
          send();
        }));

        body.append(heading, location, actions);
        card.append(media, body);
        grid.appendChild(card);

        // Show verified links with the initial card.
        // Never insert action buttons after the card appears.
        if (verifiedUrl) {
          actions.appendChild(
            actionButton("Open page ↗", () => {
              window.open(verifiedUrl, "_blank", "noopener");
            })
          );
        }
      };

      let displayed = 0;

      const more = actionButton("Show 3 more", () => {
        void drawNext();
      });

      const refine = actionButton("Refine search", () => {
        input.value = "Developers in " + districtName;
        input.focus();
      });

      let loadingBatch = false;

      const drawNext = async () => {
        if (loadingBatch || displayed >= total) return;

        loadingBatch = true;
        more.disabled = true;
        more.textContent = "Loading...";

        try {
          const next = developers.slice(
            displayed,
            displayed + 3
          );

          // Concurrent verification for the next three developers.
          // Cards appear with their final set of actions.
          const links = await Promise.all(
            next.map(item =>
              resolveVerifiedD4Url(item.name.trim())
            )
          );

          // D4_D5_PAGINATION_BOTTOM_V1
          // Initial three cards retain their original location.
          // Continuations render after all newer chat messages.
          if (displayed > 0) {
            // Ignore a stale request after New conversation.
            if (!grid.isConnected) return;

            const nextGrid = document.createElement("div");
            nextGrid.className = "prima-d5-developer-grid";

            dynamic.appendChild(nextGrid);
            dynamic.appendChild(toolbar);

            grid = nextGrid;
          }

          next.forEach((developer, index) => {
            renderDeveloper(developer, links[index]);
          });

          displayed += next.length;
        } finally {
          loadingBatch = false;
          more.disabled = false;
          more.textContent = "Show 3 more";

          more.style.display =
            displayed < total ? "inline-flex" : "none";

          scrollToBottom();
        }
      };

      toolbar.append(more, refine);
      await drawNext();
      return;
    }

    // D5 project results use the existing card renderer
    // with district-specific continuation.
    if (d5District?.mode === "projects") {
      // D6_SEARCH_HANDOFF_V2: verified D5 results must complete the
      // existing Worker turn. Search cards are still rendered by D5.
      // Start persistence in parallel with rendering to avoid UI delay.
      const d5Continuation =
        data?.route === "d5_verified_search_fallback"
          ? null
          : postJson("/api/prima/message", {
              conversation_id: conversationId,
              user: {message: value},
              visitor_id: getPrimadomAnalyticsContext().visitor_id,
              session_id: getPrimadomAnalyticsContext().session_id,
              onboarding: {
                first_user_turn: state.firstUserTurnPending,
                awaiting_name: state.awaitingName
              },
              search_context: d5District.context,
              ...CONTEXT,
              turn: {
                version: "ConversationTurnV1",
                turn_id: turnId,
                turn_seq: turnSeq,
                phase: "tool_continuation"
              }
            }).then(final => {
              if (final?.version !== "ResponseContractV1" ||
                  final?.version === "PrimaToolRequestV1") {
                throw new Error("D5 tool continuation contract mismatch");
              }
              console.info("d6_d5_tool_continuation", {
                route: final.route,
                worker_ms: final.meta?.worker_total_ms ?? null,
                openai_calls: final.meta?.openai_calls_attempted ?? null,
                openai_tokens: final.meta?.total_openai_tokens ?? null,
                openai_usage_unknown: final.meta?.openai_usage_unknown ?? null
              });
              return final;
            });
      // Attach a rejection handler immediately: no unhandled rejection
      // while the user-facing D5 cards are being drawn.
      const completedD5Turn = d5Continuation
        ? d5Continuation.catch(error => ({error}))
        : null;

      await renderD5DistrictProjectPagesV2(
        d5District.context,
        value,
        assistant.message
      );

      // E4.4: correct the finished district response only.
      const e44OriginalText =
        String(assistant.message.textContent || "");

      const e44CorrectedText =
        primaE44ResultCopyV1(
          e44OriginalText,
          d5District.context
        );

      if (e44CorrectedText !== e44OriginalText) {
        assistant.message.textContent =
          e44CorrectedText;
      }

      if (completedD5Turn) {
        const completed = await completedD5Turn;
        if (completed?.error) {
          console.error("d6_d5_conversation_persistence_unconfirmed", completed.error);
        } else {
          state.firstUserTurnPending = false;
          state.awaitingName = Boolean(completed.meta?.name_onboarding_requested);
        }
      } else {
        console.warn("d6_d5_conversation_persistence_unconfirmed", "initial Worker request unavailable");
      }
      return;
    }

    // Do not present unrelated projects as recommended developers.
    if (f213Intent?.type === "developer" &&
        !(isToolRequest(data) && data?.action === "search_developers" &&
          data?.entity_type === "developer")) {
      await revealText(assistant.message,
        "Verified developer discovery is unavailable for this request.");
      return;
    }

    if (isToolRequest(data) || d5District?.mode === "projects") {
      console.log(
        "PrimaToolRequestV1:",
        data
      );

      if (
        data?.action === "search_developers" &&
        data?.entity_type === "developer"
      ) {
        // F213_DEVELOPER_RECOMMENDATION uses the existing D4 discovery.
        if (f213Intent?.type === "developer" && data?.route === "recommendation") {
          state.d4FacetedMatches = null;
          const q = f213Intent.searchQuery;
          const first = await fetchD4DeveloperBatch(q,0);
          if (!first.results.length) {
            await revealText(assistant.message,
              "I couldn't find matching developers in the current directory results. We can broaden your criteria.");
            return;
          }
          const composed = await f213ComposeEntityV1("developer",first,
            offset => fetchD4DeveloperBatch(q,offset));
          const count = composed.payload.results.length;
          const text = count ? composed.response.answer :
            "I couldn't find verified developers matching those conditions.";
          await revealText(assistant.message,text);
          if (count) {
            const before = new Set(dynamic.querySelectorAll(".cards"));
            await renderD4DeveloperCards(
              {...first, results: first.results.slice(0, Math.min(3, count))},
              q, assistant.message, true, count
            );
            const newCards = [...dynamic.querySelectorAll(".cards")]
              .find(node => !before.has(node));
            f213PostCardsQuestionV1(newCards,composed.response.follow_up);
          }
          state.firstUserTurnPending = false;
          state.awaitingName = Boolean(composed.response?.meta?.name_onboarding_requested);
          console.info("F213_DEVELOPER_RECOMMENDATION",{requested:f213Intent.count,verified:count,
            used_final_openai:composed.response?.meta?.used_final_openai});
          return;
        }
        state.d4FacetedMatches = null;

        const developers =
          await fetchD4DeveloperBatch(data.query, 0);

        await revealText(
          assistant.message,
          developers.result_count === 1
            ? `Let's explore ${developers.results[0]?.title || "this developer"}. Here is a quick overview of the developer.`
            : developers.result_count > 0
              ? `I found ${developers.result_count} developers in the Primadom directory. Here are three to explore. Tell me your preferred location, property type or budget, and I can help narrow the selection.`
              : "I couldn't find a developer matching your search. Try another name or refine your criteria."
        );

        await renderD4DeveloperCards(developers, data.query, assistant.message, true);
        return;
      }

      // D4_FILTERED_RECOVERY: retain normal Worker continuation.
      const d4FilteredIntent =
        /^(?:(?:show me|show|find|list)\s+)?villas?\s+by\s+.{2,90}[.!?]?$/i.test(String(data.query || "")) ||
        /^(?:(?:show me|show|find|list)\s+)?(?:all\s+)?.{2,90}\s+projects\s+(?:under|below|up to)\s+(?:AED\s*)?[\d,.]+\s*(?:million|thousand|m|k)?[.!?]?$/i.test(String(data.query || ""));

      // D4_FINAL_FILTERED_ROUTE: use verified D4 portfolio directly.
      // Never redirect these two D4 intents into the D3 Search Bridge.
      let d4FilteredContext = null;

      if (d4FilteredIntent) {
        const text = String(value || "").trim();

        const villaMatch = text.match(
          /^(?:(?:show me|show|find|list)\s+)?villas?\s+by\s+(.+?)\s*[.!?]?$/i
        );

        const budgetMatch = text.match(
          /^(?:(?:show me|show|find|list)\s+)?(?:all\s+)?(.+?)\s+projects\s+(?:under|below|up to)\s+(?:AED\s*)?([\d,.]+)\s*(million|thousand|m|k)?\s*[.!?]?$/i
        );

        if (!villaMatch && !budgetMatch) {
          throw new Error("D4 filtered intent could not be parsed");
        }

        const developerName = String(
          villaMatch?.[1] || budgetMatch?.[1] || ""
        ).trim();

        const canonicalName =
          await d4CanonicalDeveloperName(developerName);

        if (!canonicalName) {
          throw new Error("D4 developer not verified: " + developerName);
        }

        const slug = canonicalName.toLowerCase()
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        const url = new URL("/__prima_d4_developers", API_BASE);
        url.searchParams.set("project_developer", slug);

        if (villaMatch) {
          url.searchParams.set("property_type", "villa");
        }

        if (budgetMatch) {
          const amount = Number(budgetMatch[2].replace(/,/g, ""));
          const unit = String(budgetMatch[3] || "").toLowerCase();
          const multiplier = ["m", "million"].includes(unit) ? 1000000
            : ["k", "thousand"].includes(unit) ? 1000 : 1;

          if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Invalid D4 budget");
          }

          url.searchParams.set("max_price", String(amount * multiplier));
        }

        const response = await fetch(url.href);

        if (!response.ok) {
          throw new Error("D4 portfolio HTTP " + response.status);
        }

        const result = await response.json();

        if (result?.version !== "SearchContextV1" ||
            result?.entity_type !== "project" ||
            !Array.isArray(result.results)) {
          throw new Error("Invalid D4 SearchContextV1");
        }

        d4FilteredContext = { ...result, query: value };
        console.log("D4 filtered portfolio PASS:", {
          developer: canonicalName,
          count: result.result_count,
          filters: result.filters
        });
      }

      const f1RecommendationContext =
        data?.route === "recommendation" &&
        data?.action === "search_projects" &&
        data?.entity_type === "project"
          ? await primaF1RecommendationCandidatesV1(data)
          : null;

      const searchContext =
        d5District?.context ||
        d4FilteredContext ||
        f1RecommendationContext ||
        (await tryDeveloperPortfolioV1(data)) ||
        (await runPrimaProjectSearchBridge(data));

      if (
        !searchContext ||
        searchContext.version !==
          "SearchContextV1"
      ) {
        throw new Error(
          "Primadom Search returned no valid SearchContextV1"
        );
      }

      state.searchContext =
        searchContext;

      state.searchPagination =
        null;

      state.lastSearchQuery =
        value;

      try {
      data =
        await postJson(
          "/api/prima/message",
          {
            conversation_id:
              conversationId,

            user: {
              message:
                value
            },

            visitor_id:
              getPrimadomAnalyticsContext()
                .visitor_id,

            session_id:
              getPrimadomAnalyticsContext()
                .session_id,

            onboarding: {
              first_user_turn:
                state
                  .firstUserTurnPending,

              awaiting_name:
                state
                  .awaitingName
            },

            search_context:
              searchContext,

            ...CONTEXT,

            turn: {
              version:
                "ConversationTurnV1",
              turn_id:
                turnId,
              turn_seq:
                turnSeq,
              phase:
                "tool_continuation"
            }
          }
        );
      } catch (error) {
        if (!d4FilteredContext) throw error;
        console.warn("D4 filtered continuation fallback:", error);
        data = null;
      }

      if (
        isToolRequest(data) ||
        (d4FilteredContext && (
          !data?.answer ||
          (Number(d4FilteredContext.result_count) > 0 &&
           !data?.cards?.length)
        ))
      ) {
        if (!d4FilteredContext) {
          throw new Error("Prima Search continuation returned another tool request");
        }

        const count = Number(d4FilteredContext.result_count || 0);

        data = {
          version: "ResponseContractV1",
          answer: count
            ? `I found ${count} matching projects. Here are the first three.`
            : "I couldn't find matching projects with those filters.",
          cards: (d4FilteredContext.results || []).slice(0, 3).map(p => ({
            slug: p.slug,
            canonical_url: p.canonical_url,
            gallery_1: p.gallery_1,
            image_alt: p.image_alt,
            facts: {
              title: p.title,
              district: p.district,
              developer: p.developer,
              price_display: p.price_display
            }
          }))
        };
      }

      console.log(
        "Prima Search continuation:",
        {
          total_latency_ms:
            Math.round(
              performance.now() -
              started
            ),

          route:
            data?.route,

          response_type:
            data?.response_type,

          used_search:
            data?.meta
              ?.used_search,

          data
        }
      );
    }


    if (
      data?.search_pagination
        ?.version ===
          "SearchPaginationV1"
    ) {
      state.searchPagination =
        data.search_pagination;

      if (
        pendingSearchContext
      ) {
        state.searchContext =
          pendingSearchContext;
      }
    }


    // G19_LIVE_CARD_INTRO_GUARD_V1
    // The catalogue handoff can attach a card to data.cards *before* the
    // single_project_ref renderer. Both paths share the same introduction log.
    const g19IntroConversationKey = String(data?.conversation_id || state.conversationId || "");
    const g19IntroSlug = data?.single_project_ref?.slug || primaCatalogProject?.slug || "";
    const g19IntroRoute =
      data?.response_type === "answer" &&
      ["page_question", "recommendation", "exact_fact", "follow_up"].includes(data?.route);
    const g19IntroExplicitVisual =
      /\b(?:show|display|see|view|open)\b[\s\S]{0,60}\b(?:image|photo|picture|card|rendering|visual)\b/i.test(value);
    const g19IntroAlreadyShown = Boolean(
      g19IntroConversationKey && g19IntroSlug &&
      shownProjectIntroCards.get(g19IntroConversationKey)?.has(g19IntroSlug)
    );
    if (g19IntroRoute && g19IntroAlreadyShown && !g19IntroExplicitVisual &&
        Array.isArray(data?.cards)) {
      // Suppress only this known project's redundant introduction, never
      // unrelated comparison or search cards.
      data.cards = data.cards.filter(card => card?.slug !== g19IntroSlug);
    }

    // PRIMA_CATALOG_ENTITY_HANDOFF_V1
    // Attach a verified card only to a successful project answer.
    if (
      !(g19IntroRoute && g19IntroAlreadyShown && !g19IntroExplicitVisual) &&
      primaCatalogProject &&
      data &&
      !isToolRequest(data) &&
      data.route !== "off_topic" &&
      data.response_type !== "clarification" &&
      typeof data.answer === "string" &&
      primaCatalogNormalizeV1(data.answer).includes(
        primaCatalogNormalizeV1(primaCatalogProject.title)
      ) &&
      !/couldn't match|could not match|couldn't find|could not find|outside my area|couldn't reach/i
        .test(data.answer) &&
      (!data.single_project_ref ||
        data.single_project_ref.slug === primaCatalogProject.slug) &&
      !data?.cards?.length
    ) {
      data.single_project_ref = {
        entity_type: "project",
        slug: primaCatalogProject.slug,
        canonical_url: primaCatalogProject.canonical_url
      };
      data.cards = [
        primaCatalogProjectCardV1(primaCatalogProject)
      ];
    }

    const answer =
      data?.answer ||
      "I couldn't produce an answer for that request.";

    await revealText(
      assistant.message,
      answer
    );

    renderInlineBold(
      assistant.message
    );

    const previousCards =
      new Set(document.querySelectorAll(".cards"));

    renderCards(
      data?.cards
    );

    // G19_LIVE_CARD_INTRO_TRACK_V1: remember a card attached by the catalogue
    // or supplied directly in data.cards, not only one from single_project_ref.
    if (g19IntroRoute && g19IntroConversationKey && g19IntroSlug &&
        Array.isArray(data?.cards) &&
        data.cards.some(card => card?.slug === g19IntroSlug)) {
      if (!shownProjectIntroCards.has(g19IntroConversationKey)) {
        shownProjectIntroCards.set(g19IntroConversationKey, new Set());
      }
      shownProjectIntroCards.get(g19IntroConversationKey).add(g19IntroSlug);
      for (const key of shownProjectIntroCards.keys()) {
        if (key !== g19IntroConversationKey) shownProjectIntroCards.delete(key);
      }
    }

    // F26_POST_CARDS_REFINEMENT_V1
    // Initial recommendation only.
    // The question belongs after cards, not in answer text.
    if (
      data?.route === "recommendation" &&
      data?.response_type === "search_results" &&
      Array.isArray(data?.cards) &&
      data.cards.length > 0 &&
      typeof data?.follow_up === "string" &&
      data.follow_up.trim()
    ) {
      const f26NewCards = [
        ...dynamic.querySelectorAll(".cards")
      ].find(node => !previousCards.has(node));

      if (f26NewCards) {
        const f26Question =
          document.createElement("p");

        f26Question.className =
          "prima-recommendation-refinement";

        f26Question.textContent =
          data.follow_up.trim();

        // F27_REFINEMENT_TYPOGRAPHY_MATCH_V1
        // Match the existing answer typography exactly.
        const f27AnswerStyle =
          window.getComputedStyle(assistant.message);

        f26Question.style.margin =
          "12px 0 0";

        f26Question.style.fontSize =
          f27AnswerStyle.fontSize;

        f26Question.style.fontFamily =
          f27AnswerStyle.fontFamily;

        f26Question.style.fontWeight =
          f27AnswerStyle.fontWeight;

        f26Question.style.lineHeight =
          f27AnswerStyle.lineHeight;

        f26Question.style.letterSpacing =
          f27AnswerStyle.letterSpacing;

        f26Question.style.color =
          f27AnswerStyle.color;

        f26NewCards.insertAdjacentElement(
          "afterend",
          f26Question
        );
      }
    }

    // E1_6_UI_CARD_PIPELINE_TIMING_V1
    const e16UiStartMs = performance.now();

    // E1.7: no redundant project-card work for a
    // verified contextual developer fact.
    const e17ProjectCardSkipped =
      primaE17SkipProjectCardV1(value, data);

    // E04: a text-only verified fact must not trigger the optional
    // single-project card lookup. The canonical reference stays intact.
    const e04TextOnlyExactFact =
      primaE04TextOnlyExactFactV1(data);

    if (!e17ProjectCardSkipped && !e04TextOnlyExactFact) {
      await renderConfirmedProjectCard(data, value);
    }

    const e16ProjectCardReadyMs = performance.now();

    // D6_PROJECT_TO_VERIFIED_DEVELOPER_CARD_V1
    // Reuse the verified D4 renderer.
    const e16DeveloperCardShown =
      await primaRenderVerifiedProjectDeveloperV1(
        value,
        data,
        assistant.message
      );

    // E2.3: D4/D5 selected entity card, verified
    // against the Worker response and active batch.
    await primaE23RenderOrdinalCardV1(
      value,
      data,
      assistant.message
    );

    // E3.4: text answer first, contextual actions second.
    // No developer card is inserted on this path.
    primaE34RenderContextActionsV1(value, data);

    if (
      /^who\s+(?:is|was)\s+(?:the\s+)?developer\s+(?:of|for)\s+(?:that one|this one|it|that project|this project)\s*[?.!]*$/i
        .test(String(value || "").trim())
    ) {
      console.info(
        "e1_6_ui_card_pipeline_timing",
        {
          project_card_stage_ms: Math.round(
            e16ProjectCardReadyMs - e16UiStartMs
          ),
          developer_card_stage_ms: Math.round(
            performance.now() - e16ProjectCardReadyMs
          ),
          total_after_text_ms: Math.round(
            performance.now() - e16UiStartMs
          ),
          developer_card_shown:
            e16DeveloperCardShown === true,
          project_card_skipped:
            e17ProjectCardSkipped
        }
      );
    }

    // G: only the Worker-owned Funnel may emit proactive specialist CTA.
    // Preserve all existing card renderers, search quick-actions and the
    // recommendation follow-up shown after cards.
    if (
      data?.route !== "recommendation" ||
      data?.response_type !== "search_results" ||
      !Array.isArray(data?.cards) ||
      data.cards.length === 0
    ) {
      addFollowUp(
        assistant.message,
        data?.follow_up
      );
    }

    renderSearchQuickActions(
      data
    );

    if (
      data?.lead_action
    ) {
      console.log(
        "Prima lead action:",
        data.lead_action
      );
    }

      state.awaitingName =
        Boolean(
          data?.meta
            ?.name_onboarding_requested
        );

    state.firstUserTurnPending =
      false;

    scrollToBottom();
  } catch (error) {
    console.error(
      "Prima UI request failed:",
      error
    );

    assistant
      .message
      .style
      .color =
        "rgba(255,255,255,.62)";

    assistant
      .message
      .textContent =
        "I couldn't reach Prima right now. Please try again.";
  } finally {
    setBusy(
      false
    );

    input.focus();

    scrollToBottom();
  }
}


minimizeButton
  ?.addEventListener(
    "click",
    minimizeDialog
  );

  mini
    ?.addEventListener(
      "click",
      () => {
        openDialog();

        if (
          window.PRIMA_AUTO_GREETING !==
            false
        ) {
          startPrimaConversation();
        }
      }
    );

closeButton
  ?.addEventListener(
    "click",
    () => {
      if (primaNotifyHostV1('prima:embed:close')) return;
      window.location.href =
        "https://primadom.ai/en/";
    }
  );

sendButton
  ?.addEventListener(
    "click",
    send
  );

input
  ?.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
          "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();

        send();
      }
    }
  );


window.addEventListener(
  "load",
  async () => {
    removeDemoConversation();

    // RESTORE-02B: hide the neutral startup state only after the
    // actual conversation has been restored or a new one initialized.
    // The HTML itself contains no demo turns or sample project media.
    try {
      const restoreStatus = await restorePrimaConversationV1();
      if (restoreStatus === "new" &&
          window.PRIMA_AUTO_GREETING !== false) {
        await startPrimaConversation();
      }
    } finally {
      document.getElementById("prima-boot")?.remove();
    }

    requestAnimationFrame(
      () => {
        scroll.scrollTop =
          scroll.scrollHeight;

        state.savedScrollTop =
          scroll.scrollTop;
      }
    );

    console.log(
      "Prima UI live staging mode"
    );
  }
);
