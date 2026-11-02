<!--
  Vue 3: <flexova-viewer> is a standard custom element. Tell the Vue compiler about it in vite.config:
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("flexova-") } } })
  npm install @flexova/viewer
-->
<script setup>
import { ref, watch } from "vue";
import "@flexova/viewer"; // registers <flexova-viewer>

const props = defineProps({
  /** A URL, ArrayBuffer, Uint8Array or Blob/File. */
  source: { type: [String, Object], default: null },
  /** "light" | "dark" | null (follow the system). */
  theme: { type: String, default: null },
});
const emit = defineEmits(["loaded", "failed"]);
const viewer = ref(null);
const toc = ref([]);

watch(
  () => props.source,
  async (source) => {
    if (!source || !viewer.value) return;
    const bytes = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : source;
    viewer.value.load(bytes);
  },
  { immediate: true, flush: "post" },
);

function onLoad(e) {
  toc.value = e.detail.toc;
  emit("loaded", e.detail);
}
</script>

<template>
  <nav v-if="toc.length" aria-label="Contents">
    <ol>
      <li v-for="entry in toc" :key="entry.href">
        <a :href="entry.href" @click.prevent="viewer.goTo(entry.href)">{{ entry.label }}</a>
      </li>
    </ol>
  </nav>
  <flexova-viewer
    ref="viewer"
    :theme="theme"
    @flexova-load="onLoad"
    @flexova-error="emit('failed', $event.detail)"
  />
</template>
