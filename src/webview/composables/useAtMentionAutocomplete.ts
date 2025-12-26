import { ref, computed, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import { Fzf, byLengthAsc } from 'fzf';
import { useVSCode } from './useVSCode';
import type { ExtensionToWebviewMessage, WorkspaceFileInfo } from '@shared/types';

const MAX_VISIBLE_ITEMS = 10;

export function useAtMentionAutocomplete(
  inputText: Ref<string>,
  textareaRef: Ref<HTMLTextAreaElement | null>
) {
  const { postMessage, onMessage } = useVSCode();

  const isOpen = ref(false);
  const query = ref('');
  const atStartIndex = ref(-1);
  const selectedIndex = ref(0);
  const files = ref<WorkspaceFileInfo[]>([]);
  const isLoading = ref(false);
  const filesLoaded = ref(false);

  const filteredFiles = computed(() => {
    if (!query.value) {
      return files.value.slice(0, MAX_VISIBLE_ITEMS);
    }

    const searchItems = files.value.map(file => ({
      original: file,
      searchStr: `${file.relativePath} ${file.relativePath.split('/').pop() || ''}`,
    }));

    const fzf = new Fzf(searchItems, {
      selector: item => item.searchStr,
      tiebreakers: [byLengthAsc],
      limit: MAX_VISIBLE_ITEMS,
    });

    return fzf.find(query.value).map(result => result.item.original);
  });

  function handleMessage(message: ExtensionToWebviewMessage) {
    if (message.type === 'workspaceFiles') {
      files.value = message.files;
      filesLoaded.value = true;
      isLoading.value = false;
    }
  }

  let cleanup: (() => void) | null = null;

  onMounted(() => {
    cleanup = onMessage(handleMessage);
  });

  onUnmounted(() => {
    cleanup?.();
  });

  function detectAtMention(): { triggered: boolean; query: string; startIndex: number } {
    const textarea = textareaRef.value;
    if (!textarea) return { triggered: false, query: '', startIndex: -1 };

    const cursorPos = textarea.selectionStart;
    const text = inputText.value;

    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = text[i];

      if (char === ' ' || char === '\n' || char === '\t') {
        return { triggered: false, query: '', startIndex: -1 };
      }

      if (char === '@') {
        const isAtStart = i === 0 || /\s/.test(text[i - 1]);
        if (isAtStart) {
          const mentionQuery = text.slice(i + 1, cursorPos);
          return { triggered: true, query: mentionQuery, startIndex: i };
        }
        return { triggered: false, query: '', startIndex: -1 };
      }
    }

    return { triggered: false, query: '', startIndex: -1 };
  }

  function checkAndUpdateMention() {
    const result = detectAtMention();

    if (result.triggered) {
      query.value = result.query;
      atStartIndex.value = result.startIndex;

      if (!isOpen.value) {
        open();
      }

      if (selectedIndex.value >= filteredFiles.value.length) {
        selectedIndex.value = Math.max(0, filteredFiles.value.length - 1);
      }
    } else {
      close();
    }
  }

  function open() {
    if (!filesLoaded.value && !isLoading.value) {
      isLoading.value = true;
      postMessage({ type: 'requestWorkspaceFiles' });
    }
    isOpen.value = true;
    selectedIndex.value = 0;
  }

  function close() {
    isOpen.value = false;
    query.value = '';
    atStartIndex.value = -1;
    selectedIndex.value = 0;
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (!isOpen.value) return false;

    switch (event.key) {
      case 'ArrowUp':
        if (selectedIndex.value > 0) {
          selectedIndex.value--;
        } else {
          selectedIndex.value = filteredFiles.value.length - 1;
        }
        return true;

      case 'ArrowDown':
        if (selectedIndex.value < filteredFiles.value.length - 1) {
          selectedIndex.value++;
        } else {
          selectedIndex.value = 0;
        }
        return true;

      case 'Tab':
      case 'Enter':
        if (filteredFiles.value.length > 0) {
          insertMention(filteredFiles.value[selectedIndex.value]);
          return true;
        }
        return false;

      case 'Escape':
        close();
        return true;

      default:
        return false;
    }
  }

  function insertMention(file: WorkspaceFileInfo) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    const before = inputText.value.slice(0, atStartIndex.value);
    const after = inputText.value.slice(textarea.selectionStart);

    const mention = `@${file.relativePath} `;
    inputText.value = before + mention + after;

    nextTick(() => {
      const newPosition = before.length + mention.length;
      textarea.setSelectionRange(newPosition, newPosition);
      textarea.focus();
    });

    close();
  }

  function selectItem(index: number) {
    if (index >= 0 && index < filteredFiles.value.length) {
      insertMention(filteredFiles.value[index]);
    }
  }

  return {
    isOpen,
    query,
    selectedIndex,
    filteredFiles,
    isLoading,
    checkAndUpdateMention,
    handleKeyDown,
    selectItem,
    close,
  };
}
