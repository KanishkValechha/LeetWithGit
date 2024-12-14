(function () {
  console.log("LeetWithGit: Content script loaded");

  function debugLog(message) {
    console.log(`LeetWithGit: ${message}`);
    try {
      chrome.runtime.sendMessage({
        type: "debug",
        message: message,
      });
    } catch (e) {
      console.error("Error sending debug message:", e);
    }
  }

  function cleanupDescription(rawDescription) {
    // Split the description into lines
    const lines = rawDescription.split(/\n+/);

    // Clean and structure the description
    const cleanedLines = lines
      .map((line) => {
        // Remove excessive bolding and clean up
        line = line.replace(/\*\*/g, "").trim();

        // Handle specific LeetCode description patterns
        if (line.match(/^Example \d:/i)) {
          return `\n**${line}**`;
        }

        // Handle constraints section
        if (line.match(/^Constraints:/i)) {
          return `\n**Constraints:**`;
        }

        return line;
      })
      .filter((line) => line.length > 0);

    // Process and clean up the description
    const processedLines = [];
    let inExplanation = false;

    for (let i = 0; i < cleanedLines.length; i++) {
      const line = cleanedLines[i];

      // Skip duplicate or redundant lines
      if (line.match(/^(Given a|0-indexed)$/i)) continue;

      // Handle examples with proper formatting
      if (line.match(/^Example \d:/i)) {
        processedLines.push(`\n${line}`);
        inExplanation = false;
        continue;
      }

      // Handle explanation with line breaks
      if (line.startsWith("Explanation:")) {
        processedLines.push(`\n${line}`);
        inExplanation = true;
        continue;
      }

      // Add explanation lines with proper formatting
      if (inExplanation && line) {
        processedLines.push(line);
      } else if (!inExplanation) {
        processedLines.push(line);
      }
    }

    // Combine and clean up final description
    let finalDescription = processedLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return finalDescription;
  }

  function extractTextContent(element) {
    let text = "";

    // Special handling for <pre> tags to preserve formatting
    if (element.tagName === "PRE") {
      return element.textContent + "\n\n";
    }

    if (element.nodeType === Node.TEXT_NODE) {
      // Preserve original line breaks in text nodes
      text += element.textContent;
    } else if (element.nodeType === Node.ELEMENT_NODE) {
      // Add line breaks for specific block-level elements
      const breakElements = [
        "p",
        "div",
        "br",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "pre",
      ];

      // Special handling for <strong> tags to add context
      if (element.tagName === "STRONG") {
        text += `\n**${element.textContent.trim()}**\n`;
      }

      // Recursive processing of child nodes
      for (let i = 0; i < element.childNodes.length; i++) {
        text += extractTextContent(element.childNodes[i]);

        // Add line break after certain elements to preserve structure
        if (element.childNodes[i].nodeType === Node.ELEMENT_NODE) {
          const lineBreakTags = ["p", "div", "br"];
          if (
            lineBreakTags.includes(element.childNodes[i].tagName.toLowerCase())
          ) {
            text += "\n";
          }
        }
      }

      // Add line break for block elements
      if (breakElements.includes(element.tagName.toLowerCase())) {
        text += "\n";
      }
    }

    return text;
  }

  function extractProblemDescription() {
    const descriptionDivs = [
      document.querySelector(".elfjs"), // Original selector
      document.querySelector(".elfjS"), // Newer layout selector
    ];

    for (let descriptionDiv of descriptionDivs) {
      if (descriptionDiv) {
        // Use the enhanced extractTextContent method
        const rawDescription = extractTextContent(descriptionDiv);

        // Clean up the description
        return cleanupDescription(rawDescription);
      }
    }

    return "Description not found";
  }

  function extractProblemDetails() {
    // Multiple strategies to extract problem title and difficulty
    const extractionStrategies = [
      // Strategy 1: Direct selector method
      () => {
        const titleElement = document.querySelector(
          'div[data-cy="question-title"]'
        );
        const difficultyElement = document.querySelector(
          "div[data-difficulty]"
        );
        const descriptionC = extractProblemDescription();

        if (titleElement && difficultyElement) {
          return {
            title: titleElement.textContent.trim(),
            difficulty: difficultyElement.textContent.trim(),
            description: descriptionC,
          };
        }
        return null;
      },

      // Strategy 2: Problem page with newer LeetCode layout
      () => {
        const titleElement = document.querySelector(".text-title-large");
        const difficultyElement = document.querySelector(
          ".text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard"
        );

        let difficultyS;
        if (difficultyElement) {
          const classList = difficultyElement.classList;

          for (let i = 0; i < classList.length; i++) {
            const className = classList[i];
            if (className === "text-difficulty-easy") {
              difficultyS = "Easy";
              break;
            } else if (className === "text-difficulty-medium") {
              difficultyS = "Medium";
              break;
            } else if (className === "text-difficulty-hard") {
              difficultyS = "Hard";
              break;
            }
          }

          if (!difficultyS) {
            difficultyS = "unknown"; // Handle cases where no matching difficulty class is found
          }
        }

        const description = extractProblemDescription();

        if (titleElement && difficultyElement) {
          return {
            title: titleElement.textContent,
            difficulty: difficultyS,
            description: description,
          };
        }
        return null;
      },
    ];

    // Try each strategy
    for (let strategy of extractionStrategies) {
      const result = strategy();
      if (result) return result;
    }

    return {
      title: "Unknown Problem",
      difficulty: "Unknown Difficulty",
      description: "Unknown Description",
    };
  }

  function extractCode() {
    const extractionMethods = [
      // Monaco Editor (preferred for modern LeetCode)
      () => {
        const monacoEditor = document.querySelector(".monaco-editor");
        if (monacoEditor) {
          const lines = monacoEditor.querySelectorAll(".view-line");
          return Array.from(lines)
            .map((line) => line.textContent)
            .join("\n");
        }
        return null;
      },

      // CodeMirror (older LeetCode layout)
      () => {
        const codeMirror = document.querySelector(".CodeMirror");
        return codeMirror?.CodeMirror?.getValue();
      },

      // Textarea fallback
      () => {
        return document.querySelector("textarea")?.value;
      },
    ];

    for (let method of extractionMethods) {
      const code = method();
      if (code) return code;
    }

    return null;
  }

  function findLanguageButton() {
    const buttons = document.querySelectorAll(
      ".rounded.items-center.whitespace-nowrap"
    );
    const languageMap = {
      "c++": "cpp",
      java: "java",
      python: "py",
      python3: "py",
      c: "c",
      "c#": "csharp",
      javascript: "js",
      typescript: "ts",
      php: "php",
      swift: "swift",
      kotlin: "kotlin",
      dart: "dart",
      go: "go",
      ruby: "ruby",
      scala: "scala",
      rust: "rust",
      racket: "racket",
      erlang: "erlang",
      elixir: "elixir",
    };
    for (const button of buttons) {
      const languageText = button.textContent.trim().toLowerCase();
      if (languageMap.hasOwnProperty(languageText)) {
        return button;
      }
    }
    return null;
  }

  // Detect programming language based on code content
  function detectLanguage() {
    // Check for language selector or active language tab
    const languageButton = findLanguageButton();
    if (!languageButton) return "txt";

    const languageText = languageButton.textContent.trim().toLowerCase();
    const languageMap = {
      "c++": "cpp",
      java: "java",
      python: "py",
      python3: "py",
      c: "c",
      "c#": "csharp",
      javascript: "js",
      typescript: "ts",
      php: "php",
      swift: "swift",
      kotlin: "kotlin",
      dart: "dart",
      go: "go",
      ruby: "ruby",
      scala: "scala",
      rust: "rust",
      racket: "racket",
      erlang: "erlang",
      elixir: "elixir",
    };

    return languageMap[languageText] || "txt";
  }

  async function captureSubmission() {
    try {
      debugLog("Attempting to capture submission");

      // Comprehensive success detection
      const successSelectors = [
        'div[data-cy="submission-result-status"]',
        '[data-e2e-locator="submission-result"]',
        ".success-message",
        ".submission-success",
      ];

      const successElement = successSelectors.reduce(
        (found, selector) => found || document.querySelector(selector),
        null
      );

      // Check for 'Accepted' in multiple ways
      const isAccepted =
        successElement &&
        (successElement.textContent.includes("Accepted") ||
          successElement.innerHTML.includes("Accepted"));

      if (!isAccepted) {
        debugLog("No successful submission found");
        return;
      }

      debugLog("Successful submission detected!");

      // Extract problem details
      const { title, difficulty, description } = extractProblemDetails();
      const code = extractCode();

      if (!code) {
        debugLog("No code found to submit");
        return;
      }

      debugLog(
        `Problem: ${title}, Difficulty: ${difficulty}, Description:${description}`
      );
      debugLog(`Code length: ${code.length} characters`);

      // Send to background script for GitHub push
      chrome.runtime.sendMessage({
        type: "push_to_github",
        payload: {
          problemTitle: title,
          difficulty: difficulty,
          description: description,
          code: code,
          language: detectLanguage(),
        },
      });
    } catch (error) {
      debugLog(`Capture submission error: ${error.message}`);
      console.error(error);
    }
  }

  // Mutation observer for detecting submissions
  function setupSubmissionObserver() {
    debugLog("Setting up submission observer");
    const observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          captureSubmission();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Initial setup
  function init() {
    debugLog("Initializing LeetWithGit");
    setupSubmissionObserver();
  }

  // Run initialization
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
