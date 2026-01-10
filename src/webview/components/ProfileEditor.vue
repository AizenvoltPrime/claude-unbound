<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderProfile } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-vue-next';

const { t } = useI18n();

interface EnvEntry {
  id: string;
  key: string;
  value: string;
}

const visibleValues = ref<Set<string>>(new Set());

function toggleValueVisibility(id: string) {
  const next = new Set(visibleValues.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  visibleValues.value = next;
}

const props = defineProps<{
  visible: boolean;
  profile: ProviderProfile | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', profile: ProviderProfile): void;
}>();

const profileName = ref('');
const envEntries = ref<EnvEntry[]>([]);

const isEditing = computed(() => props.profile !== null);
const dialogTitle = computed(() =>
  isEditing.value ? t('settings.editProfileTitle') : t('settings.addProfileTitle')
);

const profileNameRegex = /^[a-zA-Z0-9_-]+$/;
const envKeyRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

const profileNameError = computed(() => {
  const name = profileName.value.trim();
  if (!name) return null;
  if (!profileNameRegex.test(name)) {
    return t('settings.profileNameInvalid');
  }
  return null;
});

const invalidEnvKeys = computed(() => {
  const invalid = new Set<string>();
  for (const entry of envEntries.value) {
    const key = entry.key.trim();
    if (key && !envKeyRegex.test(key)) {
      invalid.add(entry.id);
    }
  }
  return invalid;
});

const canSave = computed(() => {
  const name = profileName.value.trim();
  if (!name) return false;
  if (!profileNameRegex.test(name)) return false;
  const validEntries = envEntries.value.filter(e => e.key.trim());
  if (validEntries.length === 0) return false;
  return invalidEnvKeys.value.size === 0;
});

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addEnvEntry() {
  envEntries.value.push({ id: generateId(), key: '', value: '' });
}

function removeEnvEntry(id: string) {
  envEntries.value = envEntries.value.filter(e => e.id !== id);
}

function handleSave() {
  const env: Record<string, string> = {};
  for (const entry of envEntries.value) {
    if (entry.key.trim()) {
      env[entry.key.trim()] = entry.value;
    }
  }

  emit('save', {
    name: profileName.value.trim(),
    env,
  });
}

function handleClose() {
  emit('close');
}

watch(() => props.visible, (visible) => {
  if (visible) {
    visibleValues.value = new Set();
    if (props.profile) {
      profileName.value = props.profile.name;
      envEntries.value = Object.entries(props.profile.env).map(([key, value]) => ({
        id: generateId(),
        key,
        value,
      }));
    } else {
      profileName.value = '';
      envEntries.value = [{ id: generateId(), key: '', value: '' }];
    }
  }
});
</script>

<template>
  <Dialog :open="visible" @update:open="(open: boolean) => !open && handleClose()">
    <DialogContent class="max-w-md bg-card border-border">
      <DialogHeader>
        <DialogTitle class="text-foreground">{{ dialogTitle }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Profile Name -->
        <div>
          <Label class="block mb-2 text-primary font-medium">
            {{ t('settings.profileName') }}
          </Label>
          <Input
            v-model="profileName"
            :placeholder="t('settings.profileNamePlaceholder')"
            :class="['bg-input border-border', profileNameError && 'border-destructive']"
          />
          <p v-if="profileNameError" class="text-xs text-destructive mt-1">
            {{ profileNameError }}
          </p>
        </div>

        <!-- Environment Variables -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <Label class="text-primary font-medium">
              {{ t('settings.envVariables') }}
            </Label>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2"
              @click="addEnvEntry"
            >
              <Plus class="h-4 w-4 mr-1" />
              {{ t('common.add') }}
            </Button>
          </div>

          <div class="space-y-2 max-h-64 overflow-y-auto">
            <div
              v-for="entry in envEntries"
              :key="entry.id"
              class="flex items-center gap-2"
            >
              <Input
                v-model="entry.key"
                :placeholder="t('settings.envKeyPlaceholder')"
                :class="['flex-1 bg-input border-border text-xs', invalidEnvKeys.has(entry.id) && 'border-destructive']"
              />
              <Input
                v-model="entry.value"
                :placeholder="t('settings.envValuePlaceholder')"
                class="flex-1 bg-input border-border text-xs"
                :type="visibleValues.has(entry.id) ? 'text' : 'password'"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                @click="toggleValueVisibility(entry.id)"
              >
                <Eye v-if="!visibleValues.has(entry.id)" class="h-4 w-4" />
                <EyeOff v-else class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                @click="removeEnvEntry(entry.id)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <p class="text-xs text-muted-foreground mt-2">
            {{ t('settings.envVariablesHint') }}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleClose">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!canSave" @click="handleSave">
          {{ t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
