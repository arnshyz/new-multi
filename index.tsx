/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type PersonGeneration = string;

type FreepikContentType =
  | 'photo'
  | 'vector'
  | 'psd'
  | 'icon'
  | 'template'
  | 'video'
  | 'mockup'
  | 'background'
  | 'illustration';

interface FreepikResource {
  id: number;
  title: string;
  url: string;
  previewUrl: string;
  description?: string;
  tags: string[];
  contentType: FreepikContentType;
}

interface GenerateContentParams {
  model: string;
  contents: unknown;
}

interface FreepikContentPart {
  inlineData?: {data: string; mimeType: string};
  text?: string;
}

interface FreepikCandidate {
  content: {parts: FreepikContentPart[]};
}

interface GenerateContentResponse {
  text: string;
  candidates?: FreepikCandidate[];
  raw?: unknown;
}

interface GenerateImagesParameters {
  model: string;
  prompt: string;
  config?: {
    numberOfImages?: number;
    aspectRatio?: string;
    personGeneration?: PersonGeneration;
    imageSize?: string;
    [key: string]: unknown;
  };
}

interface GenerateImagesResponseImage {
  image: {
    imageBytes: string;
    resource: FreepikResource;
  };
}

interface GenerateImagesResponse {
  generatedImages: GenerateImagesResponseImage[];
}

interface GenerateVideosParameters {
  model: string;
  prompt: string;
  config?: {
    numberOfVideos?: number;
    [key: string]: unknown;
  };
  image?: {
    imageBytes: string;
    mimeType: string;
  };
}

interface GenerateVideosOperation {
  done: boolean;
  response?: {
    generatedVideos: Array<{
      video: {
        uri: string;
        title?: string;
        thumbnail?: string;
      };
      resource?: FreepikResource;
    }>;
  };
  metadata?: Record<string, unknown>;
}

interface FreepikSearchOptions {
  contentType?: FreepikContentType;
  perPage?: number;
  page?: number;
  order?: 'popular' | 'latest';
}

async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image preview: ${response.statusText}`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

class FreepikClient {
  private apiKey: string;
  public models: {
    generateContent: (params: GenerateContentParams) => Promise<GenerateContentResponse>;
    generateImages: (params: GenerateImagesParameters) => Promise<GenerateImagesResponse>;
    generateVideos: (params: GenerateVideosParameters) => Promise<GenerateVideosOperation>;
  };
  public operations: {
    getVideosOperation: (params: {operation: GenerateVideosOperation}) => Promise<GenerateVideosOperation>;
  };

  constructor({apiKey}: {apiKey: string}) {
    this.apiKey = apiKey;
    this.models = {
      generateContent: this.generateContent.bind(this),
      generateImages: this.generateImages.bind(this),
      generateVideos: this.generateVideos.bind(this),
    };
    this.operations = {
      getVideosOperation: this.getVideosOperation.bind(this),
    };
  }

  private async request(path: string, params: FreepikSearchOptions & {q?: string} = {}): Promise<any> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error('Freepik API key is missing.');
    }

    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.contentType) searchParams.set('content_type', params.contentType);
    if (params.perPage) searchParams.set('per_page', String(params.perPage));
    if (params.page) searchParams.set('page', String(params.page));
    if (params.order) searchParams.set('order', params.order);
    searchParams.set('include_tags', 'true');
    searchParams.set('safe', 'true');

    const url = `https://api.freepik.com${path}?${searchParams.toString()}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Freepik-API-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Freepik API request failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  private normalizeResource(item: any, fallbackType?: FreepikContentType): FreepikResource {
    const tags: string[] = Array.isArray(item.tags)
      ? item.tags
          .map((tag: any) =>
            typeof tag === 'string'
              ? tag
              : tag?.name || tag?.title || tag?.id || tag?.slug || '',
          )
          .filter(Boolean)
      : [];

    const previewUrl =
      item.preview_url ||
      item.previewURL ||
      item.preview ||
      item.thumbnail_url ||
      item.thumbnails?.[0]?.url ||
      item.assets?.preview?.url ||
      item.images?.preview?.url ||
      item.media?.preview_url ||
      item.video_files?.[0]?.link ||
      item.image ||
      item.url;

    const resourceUrl =
      item.url ||
      item.share_url ||
      item.link ||
      item.download_url ||
      item.media?.url ||
      previewUrl;

    return {
      id: Number(item.id) || Date.now(),
      title: item.title || item.name || item.description || `Freepik asset ${item.id ?? ''}`,
      url: resourceUrl,
      previewUrl: previewUrl,
      description: item.description || item.alt || item.caption,
      tags,
      contentType: (item.type || item.content_type || fallbackType || 'photo') as FreepikContentType,
    };
  }

  private async searchResources(query: string, options: FreepikSearchOptions = {}): Promise<FreepikResource[]> {
    const data = await this.request('/v1/resources', {...options, q: query});
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : [];
    return items.map((item: any) => this.normalizeResource(item, options.contentType));
  }

  private extractTextFromContents(contents: unknown): string {
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
      return contents
        .map((item) => this.extractTextFromContents(item))
        .filter(Boolean)
        .join('\n');
    }
    if (contents && typeof contents === 'object') {
      const parts = (contents as any).parts;
      if (Array.isArray(parts)) {
        return parts
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part?.text) return part.text;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
    }
    return '';
  }

  private buildTextFromResources(prompt: string, resources: FreepikResource[]): string {
    if (resources.length === 0) {
      return prompt;
    }

    const lines: string[] = [];
    lines.push(`Prompt: ${prompt}`);
    lines.push('');
    lines.push('Freepik inspiration:');
    lines.push('');

    resources.forEach((resource, index) => {
      const tags = resource.tags.slice(0, 6).join(', ') || 'No tags available';
      lines.push(`Scene ${index + 1}: ${resource.title}`);
      if (resource.description) {
        lines.push(`Description: ${resource.description}`);
      }
      lines.push(`Tags: ${tags}`);
      lines.push(`Link: ${resource.url}`);
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  private async generateContent(params: GenerateContentParams): Promise<GenerateContentResponse> {
    const promptText = this.extractTextFromContents(params.contents).trim();
    const isImageModel = params.model.toLowerCase().includes('image');
    const isVideoModel = params.model.toLowerCase().includes('video');

    const resources = await this.searchResources(promptText || 'creative', {
      contentType: isVideoModel ? 'video' : undefined,
      perPage: isImageModel ? 1 : 6,
      order: 'popular',
    });

    if (isImageModel) {
      const resource = resources[0];
      if (!resource || !resource.previewUrl) {
        throw new Error('No matching Freepik image found for your prompt.');
      }
      const imageBytes = await fetchImageAsBase64(resource.previewUrl);
      return {
        text: resource.title,
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: imageBytes,
                    mimeType: 'image/jpeg',
                  },
                },
              ],
            },
          },
        ],
        raw: {resource},
      };
    }

    const summary = this.buildTextFromResources(promptText, resources);
    return {
      text: summary,
      raw: {resources},
    };
  }

  private async generateImages(params: GenerateImagesParameters): Promise<GenerateImagesResponse> {
    const count = params.config?.numberOfImages ?? 1;
    const resources = await this.searchResources(params.prompt, {
      contentType: 'photo',
      perPage: Math.max(count, 1),
      order: 'popular',
    });

    const images: GenerateImagesResponseImage[] = [];
    for (const resource of resources.slice(0, count)) {
      if (!resource.previewUrl) continue;
      try {
        const imageBytes = await fetchImageAsBase64(resource.previewUrl);
        images.push({
          image: {
            imageBytes,
            resource,
          },
        });
      } catch (error) {
        console.warn('Failed to load Freepik preview image:', error);
      }
    }

    if (images.length === 0) {
      throw new Error('No Freepik images found for your request.');
    }

    return {generatedImages: images};
  }

  private async generateVideos(params: GenerateVideosParameters): Promise<GenerateVideosOperation> {
    const count = params.config?.numberOfVideos ?? 1;
    const resources = await this.searchResources(params.prompt, {
      contentType: 'video',
      perPage: Math.max(count, 1),
      order: 'popular',
    });

    if (!resources.length) {
      throw new Error('No Freepik videos found for your request.');
    }

    return {
      done: true,
      response: {
        generatedVideos: resources.slice(0, count).map((resource) => ({
          video: {
            uri: resource.url || resource.previewUrl,
            title: resource.title,
            thumbnail: resource.previewUrl,
          },
          resource,
        })),
      },
      metadata: {resources},
    };
  }

  private async getVideosOperation({operation}: {operation: GenerateVideosOperation}): Promise<GenerateVideosOperation> {
    return operation;
  }
}

const STORYBOARD_DIRECTOR_PROMPT = `
You are an expert Visual Story Director for Veo 3 video generation. Your mission is to create a COMPELLING NARRATIVE with perfect character consistency and continuous story flow.

# 🎬 STORY STRUCTURE REQUIREMENTS

## NARRATIVE ARC (MANDATORY):
Your story MUST follow this structure:
1. **SETUP** (Scenes 1-2): Introduce character, establish world, hint at conflict
2. **RISING ACTION** (Middle scenes): Build tension, develop conflict, show character journey
3. **CLIMAX** (Near-end scenes): Peak moment of conflict/emotion/discovery
4. **RESOLUTION** (Final scene): Conclude story, show transformation or outcome

## STORY CONTINUITY CHECKLIST:
✅ Each scene DIRECTLY continues from the previous one
✅ Actions have consequences that carry forward
✅ Character emotions evolve based on what happened before
✅ Objects/props introduced must reappear when relevant
✅ Time progression is logical (morning→afternoon→evening)
✅ Location changes make geographical sense
✅ Character goals drive the plot forward

# 👤 CHARACTER CONSISTENCY TEMPLATE

## MANDATORY CHARACTER FORMAT (Copy EXACTLY in EVERY scene):
[CHARACTER NAME]: [GENDER] character, [EXACT AGE] years old, [EXACT HEIGHT] tall, [BODY TYPE] build
- FACE: [FACE SHAPE] face, [SKIN TONE] skin, [EYE COLOR] eyes, [NOSE TYPE] nose, [MOUTH/LIPS] lips
- HAIR: [EXACT STYLE] [COLOR] hair ([LENGTH] length, [TEXTURE] texture)
- OUTFIT: Wearing [EXACT TOP DESCRIPTION], [EXACT BOTTOM DESCRIPTION], [EXACT FOOTWEAR]
- ACCESSORIES: [LIST ALL ACCESSORIES OR "none"]
- DISTINGUISHING MARKS: [SCARS/TATTOOS/BIRTHMARKS OR "none"]

Example:
ALEX: Male character, 30 years old, 5'10" tall, lean athletic build
- FACE: Angular face, warm beige skin, deep brown eyes, straight nose, thin determined lips
- HAIR: Short cropped black hair (2 inches length, straight texture)
- OUTFIT: Wearing charcoal gray hoodie with front pocket, black cargo pants with side pockets, worn brown hiking boots
- ACCESSORIES: Silver chain necklace, black digital watch on left wrist
- DISTINGUISHING MARKS: Small diagonal scar through left eyebrow

# 📝 SCENE FORMAT (Use EXACTLY this structure):

Scene [NUMBER]: [8-second HD 1080p video] - [STORY BEAT NAME]

**STORY CONTEXT**: [How this scene connects to previous events and advances the plot]

**SETTING**: [Exact location with lighting, weather, time of day, atmosphere]

**CHARACTER STATE**: 
- Emotional state: [Based on what just happened]
- Physical state: [Tired/energetic/injured based on story]
- Motivation: [What the character wants in this moment]

**CHARACTER APPEARANCE**: 
[Copy EXACT character template from above - NEVER abbreviate or skip]

**ACTION SEQUENCE (0:00-0:08)**: 
- Starting moment (0:00-0:02): [Continues from previous scene's ending]
- Core action (0:02-0:06): [Main story development]
- Transition moment (0:06-0:08): [Sets up next scene]

**OBJECTS/PROPS**: [List any important items that appear - must be consistent]

**CAMERA WORK**: 
- Shot type: [Chosen to enhance story emotion]
- Movement: [Supports narrative tension]
- Focus: [Draws attention to story elements]

**VISUAL CONSISTENCY**: 
- Visual style: "Cinematic realism, high contrast, film grain"
- Color grading: "Consistent color palette throughout all scenes"
- Quality: "1080p HD video, 24fps, professional cinematography"

# 🎯 ABSOLUTE STORYTELLING RULES:

1. **STORY FIRST**: Every scene must advance the plot or reveal character
2. **CAUSE & EFFECT**: What happens in Scene N directly influences Scene N+1
3. **EMOTIONAL JOURNEY**: Character's feelings must evolve based on events
4. **VISUAL CONTINUITY**: If character gets wet/dirty/injured, show it in next scenes
5. **TIME LOGIC**: Story timeline must make sense (can't go from night to morning instantly)
6. **PROP TRACKING**: Important objects must appear consistently when needed
7. **NO RANDOM SCENES**: Every moment must serve the overall narrative
8. **CHARACTER GROWTH**: Show how events change the character

REMEMBER: Create a COMPLETE STORY, not just random scenes. Each 8-second video is a chapter in your visual novel.
`;

// Global state
let activeMode: 'manual' | 'film' | 'image' | 'voice' | 'iklan' | 'filmmaker' = 'manual';
const generatedAssetUrls: {url: string; filename: string}[] = [];
let base64data = '';
let iklanBase64data = '';
let filmmakerBase64data = '';

let sceneCounter = 1;
let currentUserName = ''; // Store current user name for Telegram
let sharingEnabled = true; // Store sharing preference (default: true for backward compatibility)
let promptMode: 'single' | 'batch' = 'single'; // Store prompt mode (single or batch)



// Helper function to set loading state properly - prevents double loading classes
function setLoadingState(element: HTMLElement, message: string, isRetry: boolean = false, retryAttempt?: number) {
  // Remove any existing loading classes first
  element.classList.remove('loading');
  
  // Set the content based on whether it's a retry
  if (isRetry && retryAttempt) {
    element.innerHTML = `Please Wait... (${retryAttempt})`;
  } else {
    element.innerHTML = message;
  }
  
  // Add loading class once
  element.classList.add('loading');
}

// Helper function to clear loading state
function clearLoadingState(element: HTMLElement) {
  element.classList.remove('loading');
}

// AI Prompt Enhancement Function for Video Generation
async function enhanceVideoPrompt(originalPrompt: string): Promise<string> {
  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) return originalPrompt;

  const ai = new FreepikClient({apiKey});
  
  const enhancementPrompt = `You are an expert video prompt engineer for Veo 3. Your task is to enhance and expand the user's prompt while maintaining their original intent and vision. Make it more detailed, cinematic, and descriptive.

IMPORTANT RULES:
1. PRESERVE the user's original concept - don't change what they want
2. ADD rich details about visuals, lighting, camera work, and atmosphere
3. ENHANCE with cinematic language and professional video terminology
4. MAINTAIN the same subjects, actions, and style the user requested
5. EXPAND descriptions to help AI generate better quality video
6. Keep it natural and flowing - not a rigid template

User's original prompt: "${originalPrompt}"

Enhance this prompt by adding:
- Visual details (textures, colors, materials, scale)
- Lighting and atmosphere (time of day, weather, mood)
- Camera specifications (angle, movement, framing)
- Motion and dynamics (speed, direction, transitions)
- Environmental context (setting details, background elements)
- Artistic style if applicable (cinematic, realistic, stylized)

Return an enhanced, natural-flowing prompt that feels like a detailed description of the exact video the user wants. Make it rich and cinematic while staying true to their vision. Keep it under 200 words but pack it with vivid details.

DO NOT use rigid templates or forced structure. Write it as a flowing, natural description that a cinematographer would understand.`;

  try {
    const response = await ai.models.generateContent({
      model: 'freepik-text',
      contents: enhancementPrompt
    });
    
    const enhancedText = response.text?.trim() || originalPrompt;
    return enhancedText;
  } catch (error) {
    console.error('Failed to enhance prompt:', error);
    return originalPrompt;
  }
}

// Helper function to clear inputs from other modes to prevent cross-contamination
function clearOtherModeInputs(currentMode: string) {
  if (currentMode !== 'manual') {
    // Clear manual mode inputs
    const manualPrompts = document.querySelectorAll('#manual-mode-panel .prompt-input') as NodeListOf<HTMLTextAreaElement>;
    manualPrompts.forEach(input => input.value = '');
  }
  
  if (currentMode !== 'image') {
    // Clear image mode input
    const imagePromptInput = document.querySelector('#image-prompt-input') as HTMLTextAreaElement;
    if (imagePromptInput) imagePromptInput.value = '';
  }
  

  
  if (currentMode !== 'voice') {
    // Clear voice mode input
    const voiceScriptInput = document.querySelector('#voice-script-input') as HTMLTextAreaElement;
    if (voiceScriptInput) voiceScriptInput.value = '';
  }
  
  if (currentMode !== 'film') {
    // Clear film mode input
    const filmTopicInput = document.querySelector('#film-topic-input') as HTMLInputElement;
    if (filmTopicInput) filmTopicInput.value = '';
  }
  
  if (currentMode !== 'filmmaker') {
    // Clear filmmaker mode input
    const filmmakerStoryInput = document.querySelector('#filmmaker-story-input') as HTMLTextAreaElement;
    if (filmmakerStoryInput) filmmakerStoryInput.value = '';
  }
}

// DOM Elements
const heroSection = document.querySelector('#hero-section') as HTMLElement;
const generatorSection = document.querySelector(
  '#generator-section',
) as HTMLElement;
const startGeneratingBtn = document.querySelector(
  '#start-generating-btn',
) as HTMLButtonElement;
const supportBtn = document.querySelector(
  '#support-btn',
) as HTMLButtonElement;
const ipCheckModal = document.querySelector('#ip-check-modal') as HTMLDivElement;
const ipLoading = document.querySelector('#ip-loading') as HTMLDivElement;
const ipDisplay = document.querySelector('#ip-display') as HTMLDivElement;
const userIpElement = document.querySelector('#user-ip') as HTMLParagraphElement;
const continueToAccessBtn = document.querySelector('#continue-to-access') as HTMLButtonElement;
const accessGate = document.querySelector('#access-gate') as HTMLDivElement;
const generatorApp = document.querySelector('.generator-app') as HTMLDivElement;
const accessForm = document.querySelector('#access-form') as HTMLFormElement;
const userNameInput = document.querySelector(
  '#user-name-input',
) as HTMLInputElement;
const accessCodeInput = document.querySelector(
  '#access-code-input',
) as HTMLInputElement;
const accessError = document.querySelector(
  '#access-error',
) as HTMLParagraphElement;
const modeDropdownButton = document.querySelector(
  '#mode-dropdown-button',
) as HTMLButtonElement;
const modeDropdownMenu = document.querySelector(
  '#mode-dropdown-menu',
) as HTMLDivElement;
const modeDropdownContainer = document.querySelector(
  '.mode-dropdown-container',
) as HTMLDivElement;
const selectedModeText = document.querySelector(
  '#selected-mode-text',
) as HTMLSpanElement;
const manualModePanel = document.querySelector(
  '#manual-mode-panel',
) as HTMLDivElement;
const filmModePanel = document.querySelector(
  '#film-mode-panel',
) as HTMLDivElement;
const imageModePanel = document.querySelector(
  '#image-mode-panel',
) as HTMLDivElement;
const voiceModePanel = document.querySelector(
  '#voice-mode-panel',
) as HTMLDivElement;
const iklanModePanel = document.querySelector(
  '#iklan-mode-panel',
) as HTMLDivElement;
const filmmakerModePanel = document.querySelector(
  '#filmmaker-mode-panel',
) as HTMLDivElement;

const filmTopicInput = document.querySelector(
  '#film-topic-input',
) as HTMLInputElement;
const sceneCountInput = document.querySelector(
  '#scene-count-input',
) as HTMLInputElement;
// Removed downloadAllButton since the button is no longer in HTML
const resultsContainer = document.querySelector(
  '#results-container',
) as HTMLDivElement;
const placeholder = resultsContainer.querySelector(
  '.placeholder',
) as HTMLDivElement;
const fileInput = document.querySelector('#file-input') as HTMLInputElement;
const fileNameEl = document.querySelector('#file-name') as HTMLSpanElement;
const imagePreviewContainer = document.querySelector(
  '#image-preview-container',
) as HTMLDivElement;
const imagePreview = document.querySelector(
  '#image-preview',
) as HTMLImageElement;
const removeImageButton = document.querySelector(
  '#remove-image-button',
) as HTMLButtonElement;
const promptsContainer = document.querySelector(
  '#prompts-container',
) as HTMLDivElement;
const addSceneButton = document.querySelector(
  '#add-scene-button',
) as HTMLButtonElement;
const enhancePromptButton = document.querySelector(
  '#enhance-prompt-button',
) as HTMLButtonElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const globalStatusEl = document.querySelector(
  '#global-status',
) as HTMLParagraphElement;
const supportSection = document.querySelector(
  '#support-section',
) as HTMLElement;
const closeSupportBtn = document.querySelector(
  '#close-support-btn',
) as HTMLButtonElement;
// Image Mode Elements
const imagePromptInput = document.querySelector(
  '#image-prompt-input',
) as HTMLTextAreaElement;
const imageModelSelect = document.querySelector(
  '#image-model-select',
) as HTMLSelectElement;
const imageCountInput = document.querySelector(
  '#image-count-input',
) as HTMLInputElement;
const personGenerationSelect = document.querySelector(
  '#person-generation-select',
) as HTMLSelectElement;
const imageSizeSelect = document.querySelector(
  '#image-size-select',
) as HTMLSelectElement;
// Voice Mode Elements
const voiceScriptInput = document.querySelector(
  '#voice-script-input',
) as HTMLTextAreaElement;
const voiceSelect = document.querySelector(
  '#voice-select',
) as HTMLSelectElement;
const voiceTemperature = document.querySelector(
  '#voice-temperature',
) as HTMLInputElement;
const temperatureValue = document.querySelector(
  '#temperature-value',
) as HTMLSpanElement;
// Prompt Mode Toggle Elements
const promptModeToggle = document.querySelector(
  '.prompt-mode-toggle',
) as HTMLDivElement;
const promptModeInfo = document.querySelector(
  '#prompt-mode-info',
) as HTMLParagraphElement;
// Iklan Mode Elements
const iklanFileInput = document.querySelector('#iklan-file-input') as HTMLInputElement;
const iklanFileNameEl = document.querySelector('#iklan-file-name') as HTMLSpanElement;
const iklanImagePreviewContainer = document.querySelector(
  '#iklan-image-preview-container',
) as HTMLDivElement;
const iklanImagePreview = document.querySelector(
  '#iklan-image-preview',
) as HTMLImageElement;
const removeIklanImageButton = document.querySelector(
  '#remove-iklan-image-button',
) as HTMLButtonElement;
const iklanLanguageSelect = document.querySelector(
  '#iklan-language-select',
) as HTMLSelectElement;
const iklanVoiceSelect = document.querySelector(
  '#iklan-voice-select',
) as HTMLSelectElement;
// Film Maker Elements
const filmmakerFileInput = document.querySelector('#filmmaker-file-input') as HTMLInputElement;
const filmmakerFileNameEl = document.querySelector('#filmmaker-file-name') as HTMLSpanElement;
const filmmakerImagePreviewContainer = document.querySelector(
  '#filmmaker-image-preview-container',
) as HTMLDivElement;
const filmmakerImagePreview = document.querySelector(
  '#filmmaker-image-preview',
) as HTMLImageElement;
const removeFilmmakerImageButton = document.querySelector(
  '#remove-filmmaker-image-button',
) as HTMLButtonElement;
const filmmakerStoryInput = document.querySelector(
  '#filmmaker-story-input',
) as HTMLTextAreaElement;
const filmmakerSceneCount = document.querySelector(
  '#filmmaker-scene-count',
) as HTMLInputElement;


// Utility Functions
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, delay: number) => void,
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`Attempt ${attempt} failed. Aggressive retry...`, e);
      // Aggressive retry with 0.3ms delay for burst retries
      const delayMs = 0.3;
      onRetry(attempt, delayMs);
      await delay(delayMs);
      attempt++;
    }
  }
}

// Convert base64 PCM audio to WAV format for browser playback
function createWavHeader(sampleRate: number, numChannels: number, bitsPerSample: number, dataSize: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF'); // ChunkID
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(8, 'WAVE'); // Format
  writeString(12, 'fmt '); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // ByteRate
  view.setUint16(32, numChannels * bitsPerSample / 8, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample
  writeString(36, 'data'); // Subchunk2ID
  view.setUint32(40, dataSize, true); // Subchunk2Size
  
  return buffer;
}

function pcmToWav(base64PCM: string): Blob {
  // Decode base64 to binary
  const binaryString = atob(base64PCM);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  // Create WAV header (24kHz, 16-bit, mono as per API spec)
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const header = createWavHeader(sampleRate, numChannels, bitsPerSample, pcmData.length);

  // Combine header and PCM data
  const wavData = new Uint8Array(header.byteLength + pcmData.length);
  wavData.set(new Uint8Array(header), 0);
  wavData.set(pcmData, header.byteLength);

  return new Blob([wavData], { type: 'audio/wav' });
}

function createToneWav(durationSeconds: number, frequency: number): Blob {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const totalSamples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
  const header = createWavHeader(sampleRate, numChannels, bitsPerSample, dataSize);
  const wavBuffer = new ArrayBuffer(header.byteLength + dataSize);
  const headerArray = new Uint8Array(header);
  const wavArray = new Uint8Array(wavBuffer);
  wavArray.set(headerArray, 0);
  const dataView = new DataView(wavBuffer, header.byteLength);

  for (let i = 0; i < totalSamples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.3;
    const value = Math.max(-1, Math.min(1, sample));
    dataView.setInt16(i * 2, Math.round(value * 0x7fff), true);
  }

  return new Blob([wavBuffer], {type: 'audio/wav'});
}

// Natural Voice TTS Generation with Context-Aware Instructions
async function generateNaturalTTSAudio(
  text: string,
  voiceName: string,
  language: string,
  productContext: string,
): Promise<{url: string; filename: string} | null> {
  // Determine tone and style based on product context and language
  let voiceInstruction = '';
  
  // Analyze product context to determine appropriate tone
  const context = productContext.toLowerCase();
  const isFood = context.includes('food') || context.includes('drink') || context.includes('restaurant') || context.includes('coffee') || context.includes('eat') || context.includes('makanan') || context.includes('minuman') || context.includes('roti') || context.includes('nasi') || context.includes('snack');
  const isTech = context.includes('phone') || context.includes('computer') || context.includes('app') || context.includes('digital') || context.includes('tech') || context.includes('smartphone') || context.includes('laptop') || context.includes('gadget') || context.includes('elektronik');
  const isFashion = context.includes('fashion') || context.includes('clothes') || context.includes('style') || context.includes('beauty') || context.includes('baju') || context.includes('sepatu') || context.includes('tas') || context.includes('pakaian') || context.includes('kosmetik');
  const isHealth = context.includes('health') || context.includes('medical') || context.includes('fitness') || context.includes('care') || context.includes('kesehatan') || context.includes('obat') || context.includes('vitamin') || context.includes('olahraga');
  const isService = context.includes('service') || context.includes('layanan') || context.includes('jasa') || context.includes('konsultasi') || context.includes('delivery') || context.includes('transport');
  const isEducation = context.includes('education') || context.includes('course') || context.includes('book') || context.includes('belajar') || context.includes('kursus') || context.includes('sekolah');
  
  // Create natural voice instructions based on context and language
  if (language === 'id-ID') {
    if (isFood) {
      voiceInstruction = `Ucapkan dengan nada hangat dan menggugah selera, seperti food vlogger yang sedang review makanan enak: "${text}"`;
    } else if (isTech) {
      voiceInstruction = `Sampaikan dengan nada excited dan tech-savvy, seperti unboxing gadget baru yang ditunggu-tunggu: "${text}"`;
    } else if (isFashion) {
      voiceInstruction = `Ucapkan dengan nada trendy dan confident, seperti fashion influencer yang lagi showcase outfit OOTD: "${text}"`;
    } else if (isHealth) {
      voiceInstruction = `Sampaikan dengan nada caring dan motivational, seperti fitness trainer yang support client: "${text}"`;
    } else if (isService) {
      voiceInstruction = `Ucapkan dengan nada helpful dan reliable, seperti customer service yang baik banget: "${text}"`;
    } else if (isEducation) {
      voiceInstruction = `Sampaikan dengan nada inspiring dan encouraging, seperti mentor yang motivasi murid: "${text}"`;
    } else {
      voiceInstruction = `Ucapkan dengan nada natural dan conversational, seperti lagi ngobrol santai sama bestie: "${text}"`;
    }
  } else {
    if (isFood) {
      voiceInstruction = `Say this with a mouth-watering, enthusiastic tone like a food reviewer discovering something amazing: "${text}"`;
    } else if (isTech) {
      voiceInstruction = `Deliver with an excited, tech-enthusiast tone like unboxing the latest must-have gadget: "${text}"`;
    } else if (isFashion) {
      voiceInstruction = `Speak with a trendy, confident tone like a fashion influencer showcasing the perfect look: "${text}"`;
    } else if (isHealth) {
      voiceInstruction = `Say with a motivational, caring tone like a personal trainer cheering on their client: "${text}"`;
    } else if (isService) {
      voiceInstruction = `Speak with a helpful, reliable tone like excellent customer service: "${text}"`;
    } else if (isEducation) {
      voiceInstruction = `Deliver with an inspiring, encouraging tone like a mentor motivating students: "${text}"`;
    } else {
      voiceInstruction = `Speak with a natural, conversational tone like chatting with your best friend: "${text}"`;
    }
  }

  return generateTTSAudio(voiceInstruction, voiceName, 1.2);
}

// Core Voice TTS Generation Logic  
async function generateTTSAudio(
  text: string,
  voiceName: string,
  temperature: number,
): Promise<{url: string; filename: string} | null> {
  if (!text.trim()) return null;

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const wordCount = normalizedText.split(' ').filter(Boolean).length;
  const durationSeconds = Math.max(2, Math.min(10, wordCount * 0.6));
  const voiceSeed = voiceName ? voiceName.charCodeAt(0) : 0;
  const baseFrequency = 220 + (voiceSeed % 220);
  const frequency = Math.max(120, Math.min(880, baseFrequency + Math.round((temperature - 1) * 40)));

  const wavBlob = createToneWav(durationSeconds, frequency);
  const objectURL = URL.createObjectURL(wavBlob);
  const filename = `voice-${Date.now()}.wav`;
  return {url: objectURL, filename};
}



// Smart Video Voice-Over Generation with AI Analysis & Voice Selection
async function generateSmartVideoVoiceOver(
  videoPrompt: string,
  audioContainer: HTMLDivElement,
  actionsContainer: HTMLDivElement,
  videoEl: HTMLVideoElement,
) {
  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) return;

  try {
    audioContainer.innerHTML = '<p class="status">Analyzing content & generating voice-over...</p>';
    
    const ai = new FreepikClient({apiKey});
    
    // STEP 1: Deep Content Analysis & Voice Selection
    const analysisPrompt = `Analyze this video content and recommend the perfect voice & script:

VIDEO CONTENT: "${videoPrompt}"

Available Voices:
- BRIGHT & UPBEAT: Zephyr, Puck, Autonoe, Laomedeia
- FIRM & STRONG: Kore, Orus, Alnilam  
- SMOOTH & CLEAR: Aoede, Algieba, Erinome, Iapetus, Despina
- EASY-GOING & CASUAL: Umbriel, Callirrhoe, Zubenelgenubi
- INFORMATIVE & KNOWLEDGEABLE: Charon, Rasalgethi, Sadaltager
- SOFT & GENTLE: Enceladus, Vindemiatrix, Sulafat
- SPECIAL: Fenrir (Excitable), Leda (Youthful), Schedar (Even), Achird (Friendly), Gacrux (Mature), Sadachbia (Lively), Algenib (Gravelly), Pulcherrima (Forward)

REQUIREMENTS:
1. Analyze video content: mood, theme, energy, target audience
2. Select 1 PERFECT voice from the list above 
3. Create POV storytelling script (maximum 8 words) as if someone is narrating what they're witnessing
4. Use conversational, storytelling tone like "Look at this..." "Watch as..." "Here we see..." etc.

FORMAT:
VOICE: [exact voice name from list]
SCRIPT: [POV storytelling script, max 8 words]
TONE: [delivery tone/style instruction]

Example responses:
VOICE: Puck
SCRIPT: Watch this incredible moment unfold before us
TONE: Excited observer sharing something amazing

VOICE: Aoede  
SCRIPT: Here's a peaceful scene that touches hearts
TONE: Gentle storyteller describing beauty

Now analyze: "${videoPrompt}"`;

    const analysisResponse = await retryWithBackoff(
      () => ai.models.generateContent({
        model: 'freepik-text',
        contents: analysisPrompt,
      }),
      (attempt: number) => {
        audioContainer.innerHTML = `<p class="status loading">Analyzing content... (${attempt})</p>`;
      }
    );

    const analysisText = analysisResponse.text.trim();
    console.log('AI Voice Analysis:', analysisText);

    // Parse AI response
    const voiceMatch = analysisText.match(/VOICE:\s*([A-Za-z]+)/i);
    const scriptMatch = analysisText.match(/SCRIPT:\s*(.+?)(?=\nTONE:|$)/i);
    const toneMatch = analysisText.match(/TONE:\s*(.+?)(?=\n|$)/i);

    const selectedVoice = voiceMatch ? voiceMatch[1].trim() : 'Erinome';
    let voiceOverScript = scriptMatch ? scriptMatch[1].trim() : 'Here\'s something incredible to witness';
    const deliveryTone = toneMatch ? toneMatch[1].trim() : 'Conversational storyteller';

    // Ensure script is max 8 words
    const words = voiceOverScript.split(' ').filter(word => word.length > 0);
    if (words.length > 8) {
      voiceOverScript = words.slice(0, 8).join(' ');
    }

    if (words.length < 3) {
      voiceOverScript = 'Look at this amazing moment';
    }

    console.log(`🎭 AI Selected Voice: ${selectedVoice}`);
    console.log(`📝 POV Script: "${voiceOverScript}"`);
    console.log(`🎵 Delivery Tone: ${deliveryTone}`);

    // STEP 2: Generate Enhanced POV Voice-Over
    const povPrompt = `As a ${deliveryTone}, say this with the perfect POV storytelling delivery: "${voiceOverScript}"

Context: ${videoPrompt}
Style: ${deliveryTone}

Deliver it naturally as if you're personally witnessing and narrating this moment to a friend.`;

    const audioData = await retryWithBackoff(
      () => generateTTSAudio(povPrompt, selectedVoice, 1.3),
      (attempt: number) => {
        audioContainer.innerHTML = `<p class="status loading">Creating ${selectedVoice} voice-over... (${attempt})</p>`;
      }
    );

    if (audioData) {
      // Clear container and add synced audio
      audioContainer.innerHTML = '';
      
      const audioEl = document.createElement('audio');
      audioEl.controls = false; // Hide controls since it will be synced
      audioEl.src = audioData.url;
      audioEl.volume = 0.8;
      audioContainer.appendChild(audioEl);

      // Auto-sync with video playback
      videoEl.addEventListener('play', () => {
        audioEl.currentTime = videoEl.currentTime;
        audioEl.play();
      });
      
      videoEl.addEventListener('pause', () => {
        audioEl.pause();
      });
      
      videoEl.addEventListener('seeked', () => {
        audioEl.currentTime = videoEl.currentTime;
      });
      
      videoEl.addEventListener('ended', () => {
        audioEl.pause();
        audioEl.currentTime = 0;
      });

      // Show sync status
      const syncStatus = document.createElement('div');
      syncStatus.className = 'sync-status';
      syncStatus.innerHTML = '🎙️ Smart voice-over terintegrasi';
      audioContainer.appendChild(syncStatus);

      // Add download button
      const downloadAudioButton = document.createElement('button');
      downloadAudioButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Voice-Over`;
      downloadAudioButton.className = 'card-button';
      downloadAudioButton.onclick = () => downloadFile(audioData.url, audioData.filename);
      actionsContainer.prepend(downloadAudioButton);

      generatedAssetUrls.push({url: audioData.url, filename: audioData.filename});
    } else {
      audioContainer.innerHTML = '<p class="status-error">Could not generate voice-over.</p>';
    }
  } catch (e) {
    console.error('Smart voice-over generation failed:', e);
    audioContainer.innerHTML = '<p class="status-error">Voice-over generation failed.</p>';
  }
}

// Core Audio Generation Logic
async function generateAudioFromText(
  text: string,
): Promise<{url: string; filename: string} | null> {
  if (!text.trim()) return null;
  return generateTTSAudio(text, 'FreepikVoice', 1);
}



// Core Image Generation Logic
async function generateImages() {
  const prompt = imagePromptInput.value.trim();
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';
  
  if (!prompt) {
    globalStatusEl.innerText = 'Please enter a prompt for the image.';
    return;
  }

  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) {
    globalStatusEl.innerText =
      'Error: API Key is not configured. Please contact the administrator.';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  // Create result item with processing status first
  const resultItem = document.createElement('div');
  resultItem.className = 'result-item';
  
  const statusEl = document.createElement('p');
  statusEl.className = 'status';
  setLoadingState(statusEl, 'Generating images');
  resultItem.appendChild(statusEl);
  
  resultsContainer.prepend(resultItem);

  const onRetryCallback = (attempt: number) => {
    statusEl.innerHTML = `🔄 Searching Freepik library... (${attempt})`;
    statusEl.classList.add('loading');
  };

  try {
    const ai = new FreepikClient({apiKey});
    const model = imageModelSelect.value;
    const numberOfImages = parseInt(imageCountInput.value, 10);
    const aspectRatioSelector = document.querySelector(
      '#image-aspect-ratio-selector .tab-button.active',
    ) as HTMLButtonElement;
    const aspectRatio = aspectRatioSelector.dataset.ratio ?? '1:1';
    const personGeneration = personGenerationSelect.value as PersonGeneration;
    const imageSize = imageSizeSelect.disabled
      ? undefined
      : imageSizeSelect.value;

    const config: any = {
      numberOfImages,
      aspectRatio,
      personGeneration,
      outputMimeType: 'image/jpeg',
    };
    
    if (imageSize) {
      config.imageSize = imageSize;
    }

    statusEl.innerHTML = ' Generating images';
    statusEl.classList.add('loading');
    const response = await retryWithBackoff(
      () => ai.models.generateImages({
      model,
      prompt,
      config,
      }),
      onRetryCallback,
    );

    // Clear the processing status
    statusEl.remove();
    
    for (const generatedImage of response.generatedImages) {
      const base64ImageBytes = generatedImage.image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
      const filename = `image-${Date.now()}.jpeg`;
      generatedAssetUrls.push({url: imageUrl, filename});

      // Send image to Telegram bot
      try {
        await sendImageToTelegram(imageUrl, prompt, currentUserName);
        console.log('✅ Image sent to Telegram successfully!');
      } catch (error) {
        console.warn('❌ Failed to send image to Telegram:', error);
      }

      // Create individual result item for each image
      const imageResultItem = document.createElement('div');
      imageResultItem.className = 'result-item';
      imageResultItem.dataset.filename = filename;

      // Create Delete Button
      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-button';
      deleteButton.innerHTML = '&times;';
      deleteButton.setAttribute('aria-label', 'Delete image');
      deleteButton.onclick = () => {
        const filenameToDelete = imageResultItem.dataset.filename;
        const indexToDelete = generatedAssetUrls.findIndex(
          (v) => v.filename === filenameToDelete,
        );
        if (indexToDelete > -1) {
          generatedAssetUrls.splice(indexToDelete, 1);
        }
        imageResultItem.remove();

        if (resultsContainer.childElementCount === 1) { // only placeholder is left
          placeholder.style.display = 'flex';
        }
        
        // Download all button removed
      };

      const promptDisplay = document.createElement('pre');
      promptDisplay.className = 'card-prompt';
      promptDisplay.textContent = prompt;

      const imageContainer = document.createElement('div');
      imageContainer.className = 'image-container';
      const aspectClass = `aspect-${aspectRatio.replace(':', '-')}`;
      imageContainer.classList.add(aspectClass);

      const imgEl = document.createElement('img');
      imgEl.src = imageUrl;
      imgEl.alt = prompt;
      imageContainer.appendChild(imgEl);

      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'card-actions';

      const downloadButton = document.createElement('button');
      downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Image`;
      downloadButton.className = 'card-button';
      downloadButton.onclick = () => downloadFile(imageUrl, filename);

      actionsContainer.appendChild(downloadButton);
      imageResultItem.appendChild(deleteButton);
      imageResultItem.appendChild(promptDisplay);
      imageResultItem.appendChild(imageContainer);
      imageResultItem.appendChild(actionsContainer);

      resultsContainer.prepend(imageResultItem);
    }

    // Remove the initial processing result item
    resultItem.remove();
    // Download all button removed
  } catch (e) {
    statusEl.innerText = `Error: ${e.message}`;
    statusEl.style.color = '#f472b6';
    console.error('Image generation failed:', e);
  } finally {
    // Clear other mode inputs to prevent cross-contamination
    clearOtherModeInputs('image');
  }
}

// Core Video Generation Logic with Veo 3 Auto-Switching
async function generateAndDisplayVideo(
  prompt: string,
  resultItem: HTMLDivElement,
  aspectRatio: string,
  imageBase64: string | null = null,
  skipVoiceOver: boolean = false,
) {
  const statusEl = resultItem.querySelector('.status') as HTMLParagraphElement;
  const apiKey = process.env.FREEPIK_API_KEY;

  if (!apiKey) {
    statusEl.innerText =
      'Error: API Key is not configured. Please contact the administrator.';
    statusEl.style.color = '#f472b6';
    return;
  }

  const ai = new FreepikClient({apiKey});
  
  // Build enhanced prompt with aspect ratio instruction
  let enhancedPrompt = prompt;
  if (aspectRatio === '9:16') {
    enhancedPrompt = `${prompt} --prefer vertical 9:16 compositions suitable for social media stories.`;
  } else {
    enhancedPrompt = `${prompt} --prefer cinematic 16:9 landscape framing.`;
  }

  if (imageBase64) {
    enhancedPrompt += '\nReference image provided for visual context.';
  }

  const config: GenerateVideosParameters = {
    model: 'freepik-video',
    prompt: enhancedPrompt,
    config: {
      numberOfVideos: 1,
    },
  };

  const onRetryCallback = (attempt: number) => {
    statusEl.innerHTML = `🔄 Searching Freepik library... (${attempt})`;
    statusEl.classList.add('loading');
  };

  try {
    setLoadingState(statusEl, '🔍 Searching Freepik videos');
    
    const operation = await retryWithBackoff(
      () => ai.models.generateVideos(config),
      onRetryCallback,
    );

    const videos = operation.response?.generatedVideos ?? [];
    if (!videos.length) {
      throw new Error('No Freepik videos were found for this prompt.');
    }

    setLoadingState(statusEl, '⬇️ Downloading Freepik preview');
    const videoData = videos[0];
    const resource = videoData.resource;
    const rawVideoUrl = videoData.video.uri || resource?.previewUrl;

    if (!rawVideoUrl) {
      throw new Error('Freepik did not return a video preview URL.');
    }

    let blob: Blob | null = null;
    let objectURL = rawVideoUrl;
    try {
      const downloadResponse = await fetch(rawVideoUrl);
      if (downloadResponse.ok) {
        blob = await downloadResponse.blob();
        objectURL = URL.createObjectURL(blob);
      } else {
        console.warn('Unable to download Freepik preview directly:', downloadResponse.statusText);
      }
    } catch (error) {
      console.warn('Failed to fetch Freepik video preview:', error);
    }

    const filename = `video-${Date.now()}.mp4`;
    generatedAssetUrls.push({url: objectURL, filename});
    resultItem.dataset.filename = filename; // Associate filename with the element

    if (blob) {
      try {
        await sendVideoToTelegram(blob, prompt, currentUserName);
        console.log('✅ Video sent to Telegram successfully!');
      } catch (error) {
        console.warn('❌ Failed to send video to Telegram:', error);
      }
    }

    // Create and append card content
    resultItem.innerHTML = ''; // Clear status message

    // Create Delete Button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    deleteButton.innerHTML = '&times;';
    deleteButton.setAttribute('aria-label', 'Delete video');
    deleteButton.onclick = () => {
      const filenameToDelete = resultItem.dataset.filename;
      const indexToDelete = generatedAssetUrls.findIndex(
        (v) => v.filename === filenameToDelete,
      );
      if (indexToDelete > -1) {
        generatedAssetUrls.splice(indexToDelete, 1);
      }
      resultItem.remove();

      if (resultsContainer.childElementCount === 1 && placeholder) {
        // only placeholder is left
        placeholder.style.display = 'flex';
      }

      // Download all button removed
    };
    resultItem.appendChild(deleteButton);

    const promptDisplay = document.createElement('pre');
    promptDisplay.className = 'card-prompt';
    promptDisplay.textContent = prompt;

    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    if (aspectRatio === '9:16') {
      videoContainer.classList.add('aspect-ratio-9-16');
    }
    const videoEl = document.createElement('video');
    videoEl.src = objectURL;
    if (resource?.previewUrl) {
      videoEl.poster = resource.previewUrl;
    }
    videoEl.autoplay = true;
    videoEl.loop = true;
    videoEl.controls = true;
    videoEl.muted = true;
    videoContainer.appendChild(videoEl);

    const audioContainer = document.createElement('div');
    audioContainer.className = 'audio-container';
    audioContainer.innerHTML = `<p class="status loading"> Generating voice-over</p>`;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'card-actions';

    const downloadButton = document.createElement('button');
    downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Video`;
    downloadButton.className = 'card-button';
    downloadButton.onclick = () => downloadFile(objectURL, filename);

    const extendButton = document.createElement('button');
    extendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 7.07-7.07"></path><path d="M11 7 7 3l4 4-4-4Z"></path></svg> Extend`;
    extendButton.className = 'card-button';
    extendButton.onclick = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || 1280;
      canvas.height = videoEl.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      videoEl.currentTime = Math.max(0, videoEl.duration - 0.1);
      await new Promise((resolve) => {
        videoEl.addEventListener('seeked', () => resolve(true), {once: true});
      });
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        base64data = dataUrl.split(',')[1];

        activeMode = 'manual';
        selectedModeText.textContent = 'Video Generator';
        manualModePanel.classList.remove('hidden');
        filmModePanel.classList.add('hidden');
        imageModePanel.classList.add('hidden');
        voiceModePanel.classList.add('hidden');
        iklanModePanel.classList.add('hidden');
        filmmakerModePanel.classList.add('hidden');

        const promptInput = document.querySelector('#manual-mode-panel .prompt-input') as HTMLTextAreaElement;
        promptInput.value = prompt;

        const imageDataUrl = `data:image/png;base64,${base64data}`;
        imagePreview.src = imageDataUrl;
        imagePreviewContainer.classList.remove('hidden');
        fileNameEl.textContent = 'Frame captured from video';

        scrollToElement(manualModePanel);
        globalStatusEl.innerHTML = 'Frame captured! You can now edit the prompt and regenerate.';
        globalStatusEl.style.color = '#22c55e';
      }
    };

    const addSoundButton = document.createElement('button');
    addSoundButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298V4.702Z"></path><path d="M16 9a5 5 0 0 1 0 6"></path><path d="M19.364 18.364a9 9 0 0 0 0-12.728"></path></svg> Tambahkan Suara`;
    addSoundButton.className = 'card-button';
    addSoundButton.onclick = () => {
      window.open('https://videotosfx.elevenlabs.io/', '_blank');
    };

    actionsContainer.appendChild(downloadButton);
    actionsContainer.appendChild(extendButton);
    actionsContainer.appendChild(addSoundButton);

    resultItem.appendChild(promptDisplay);
    resultItem.appendChild(videoContainer);
    
    // Only add audio container and generate voice-over if not skipped
    if (!skipVoiceOver) {
      resultItem.appendChild(audioContainer);
      // Generate smart voice-over after video is ready - aggressive timing
      setTimeout(() => {
        generateSmartVideoVoiceOver(prompt, audioContainer, actionsContainer, videoEl);
      }, 0.3);
    }
    
    resultItem.appendChild(actionsContainer);

    // Download all button removed
  } catch (e) {
    statusEl.innerText = `An error occurred: ${e.message}`;
    statusEl.style.color = '#f472b6';
    console.error('Generation failed:', e);
  }
}

// Login notification removed - no longer needed

// Send Generated Video to Telegram Bot (Group Thread)
async function sendVideoToTelegram(videoBlob: Blob, prompt: string, userName?: string): Promise<void> {
  // Check if sharing is enabled
  if (!sharingEnabled) {
    console.log('🔒 Sharing disabled by user preference. Video not sent to Telegram.');
    return;
  }
  
  const BOT_TOKEN = atob('ODQ4ODUwOTYxNTpBQUVBd05kbzFGc2FwaV9CNmlQV2d3d1NWY3pYNkl1OEJiZw=='); // New bot token encrypted
  const GROUP_CHAT_ID = '-1002905918286'; // Group chat: Veo 2 - Unlimited (corrected)
  const MESSAGE_THREAD_ID = 367; // Updated forum thread ID
  
  // Create caption with prompt and user info
  const caption = `🎬 Video Generated by Veo 3\n\n` +
                 `📝 Prompt: "${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}"\n\n` +
                 `👤 User: ${userName || 'Anonymous'}\n` +
                 `⏰ ${new Date().toLocaleString('id-ID', {timeZone: 'Asia/Jakarta'})}`;

  // Create video file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `veo_video_${timestamp}.mp4`;

  // Send to group thread
  try {
    const groupFormData = new FormData();
    groupFormData.append('chat_id', GROUP_CHAT_ID);
    groupFormData.append('message_thread_id', MESSAGE_THREAD_ID.toString());
    groupFormData.append('video', videoBlob, filename);
    groupFormData.append('caption', caption);
    groupFormData.append('parse_mode', 'HTML');
    
    console.log(`Sending video to group thread ${MESSAGE_THREAD_ID} in chat ${GROUP_CHAT_ID}...`);
    console.log(`Bot token (decoded): ${BOT_TOKEN}`);
    const groupResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      body: groupFormData,
    });
    
    if (!groupResponse.ok) {
      const errorText = await groupResponse.text();
      console.error(`Failed to send video to group thread:`, errorText);
      console.error(`Chat ID: ${GROUP_CHAT_ID}, Thread ID: ${MESSAGE_THREAD_ID}`);
    } else {
      const result = await groupResponse.json();
      console.log(`✅ Video sent to group thread ${MESSAGE_THREAD_ID} successfully!`, result);
    }
  } catch (error) {
    console.warn(`❌ Error sending video to group thread:`, error);
  }
}

// Send Generated Image to Telegram Bot (Group Thread)
async function sendImageToTelegram(imageDataUrl: string, prompt: string, userName?: string): Promise<void> {
  // Check if sharing is enabled
  if (!sharingEnabled) {
    console.log('🔒 Sharing disabled by user preference. Image not sent to Telegram.');
    return;
  }
  
  const BOT_TOKEN = atob('ODQ4ODUwOTYxNTpBQUVBd05kbzFGc2FwaV9CNmlQV2d3d1NWY3pYNkl1OEJiZw=='); // New bot token encrypted
  const GROUP_CHAT_ID = '-1002905918286'; // Group chat: Veo 2 - Unlimited (corrected)
  const MESSAGE_THREAD_ID = 367; // Updated forum thread ID
  
  // Create caption with prompt and user info
  const caption = `🖼️ Image Generated by Veo 3 Tools\n\n` +
                 `📝 Prompt: "${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}"\n\n` +
                 `👤 User: ${userName || 'Anonymous'}\n` +
                 `⏰ ${new Date().toLocaleString('id-ID', {timeZone: 'Asia/Jakarta'})}`;

  // Convert base64 to blob
  const base64Data = imageDataUrl.split(',')[1];
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

  // Create image file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `veo_image_${timestamp}.jpg`;

  // Send to group thread
  try {
    const groupFormData = new FormData();
    groupFormData.append('chat_id', GROUP_CHAT_ID);
    groupFormData.append('message_thread_id', MESSAGE_THREAD_ID.toString());
    groupFormData.append('photo', imageBlob, filename);
    groupFormData.append('caption', caption);
    groupFormData.append('parse_mode', 'HTML');
    
    console.log(`Sending image to group thread ${MESSAGE_THREAD_ID} in chat ${GROUP_CHAT_ID}...`);
    console.log(`Bot token (decoded): ${BOT_TOKEN}`);
    const groupResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: groupFormData,
    });
    
    if (!groupResponse.ok) {
      const errorText = await groupResponse.text();
      console.error(`Failed to send image to group thread:`, errorText);
      console.error(`Chat ID: ${GROUP_CHAT_ID}, Thread ID: ${MESSAGE_THREAD_ID}`);
    } else {
      const result = await groupResponse.json();
      console.log(`✅ Image sent to group thread ${MESSAGE_THREAD_ID} successfully!`, result);
    }
  } catch (error) {
    console.warn(`❌ Error sending image to group thread:`, error);
  }
}

// Download All function removed since button is no longer needed

// Telegram verification removed - no longer needed

// IP Check Functions
async function getUserIP(): Promise<string> {
  try {
    // Try multiple IP services for redundancy
    const services = [
      'https://api.ipify.org?format=json',
      'https://ipapi.co/json/',
      'https://api.myip.com'
    ];
    
    for (const service of services) {
      try {
        const response = await fetch(service);
        if (response.ok) {
          const data = await response.json();
          // Different services return IP in different fields
          return data.ip || data.query || 'Unable to detect';
        }
      } catch (err) {
        continue; // Try next service
      }
    }
    
    // If all services fail, return a fallback
    return 'IP Detection Failed';
  } catch (error) {
    console.error('Failed to get IP:', error);
    return 'Error detecting IP';
  }
}

// Film Maker Generation Logic
async function generateFilmMaker() {
  const story = filmmakerStoryInput.value.trim();
  const sceneCount = parseInt(filmmakerSceneCount.value, 10);
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';

  if (!filmmakerBase64data) {
    globalStatusEl.innerText = 'Please upload an image reference for the character.';
    return;
  }
  
  if (!story || isNaN(sceneCount) || sceneCount < 3 || sceneCount > 30) {
    globalStatusEl.innerText = 'Please enter a valid story and scene count (3-30).';
    return;
  }

  globalStatusEl.innerHTML = '🎬 Analyzing character reference...';
  if (placeholder) placeholder.style.display = 'none';

  try {
    const apiKey = process.env.FREEPIK_API_KEY;
    if (!apiKey) throw new Error('API Key is missing.');

    const ai = new FreepikClient({apiKey});
    
    // STEP 1: Analyze character image with Gemini Flash
    setLoadingState(globalStatusEl, '📸 Analyzing character from image');
    
    const characterAnalysisPrompt = `Analyze this image and provide a detailed character description.

IMPORTANT: Give me ONLY the character analysis, no other text.

Provide:
1. Physical appearance (face, body, clothing details)
2. Color palette (skin tone, hair color, outfit colors)
3. Style and aesthetic (modern, vintage, casual, formal, etc.)
4. Notable features or distinguishing marks
5. Overall vibe and personality suggested by appearance

Be very detailed and specific - this will be used to maintain consistency across multiple scenes.`;

    const characterAnalysis = await retryWithBackoff(
      () => ai.models.generateContent({
        model: 'freepik-text',
        contents: [
          {
            parts: [
              { text: characterAnalysisPrompt },
              {
                inlineData: {
                  data: filmmakerBase64data,
                  mimeType: 'image/png'
                }
              }
            ]
          }
        ]
      }),
      (attempt: number) => {
        globalStatusEl.innerHTML = `📸 Analyzing character... (${attempt})`;
      }
    );

    const characterDesc = characterAnalysis.text.trim();
    console.log('Character Analysis:', characterDesc);

    // STEP 2: Generate scene prompts based on story and character
    setLoadingState(globalStatusEl, '📝 Creating story scenes');
    
    const scenesPrompt = `You are a professional film director creating a cinematic visual story with SMOOTH story progression and DIVERSE camera angles.

CHARACTER DESCRIPTION:
${characterDesc}

STORY: ${story}
NUMBER OF SCENES: ${sceneCount}

Create ${sceneCount} detailed scene descriptions with CONTINUOUS NARRATIVE FLOW. Each scene must:
1. Feature the SAME character with consistent appearance
2. Progress SMOOTHLY from previous scene - NO BIG JUMPS in story
3. Show CONTINUOUS ACTION - each scene flows naturally to the next
4. Use DIFFERENT camera angles for visual variety (MANDATORY)
5. Maintain consistent visual style, color palette, and lighting
6. Be cinematic and film-like

STORY CONTINUITY RULES (CRITICAL):
- Scene 2 should continue DIRECTLY from Scene 1's ending
- Scene 3 should continue from Scene 2, and so on
- NO time jumps or location jumps without transition
- Show the COMPLETE journey, not just highlights
- Each scene should answer: "What happens next?"
- Think of it as a continuous 8-second video sequence

CAMERA ANGLE VARIETY (Use these across different scenes):
- Wide shot / Establishing shot (show full environment)
- Medium shot (waist up, showing interaction)
- Close-up (face, showing emotions)
- Extreme close-up (eyes, hands, specific details)
- Over-the-shoulder shot (showing perspective)
- Low angle (looking up at subject, powerful)
- High angle / Bird's eye view (looking down)
- Dutch angle / Tilted (dynamic, tension)
- Tracking shot (following movement)
- Point of view shot (seeing what character sees)

EXAMPLE SEQUENCE (for "going to school" story):
Scene 1: Wide shot - character walking out of house in morning
Scene 2: Medium shot - character walking down street, looking around
Scene 3: Close-up - nervous facial expression as school appears
Scene 4: Wide shot - character approaching school entrance
Scene 5: Over-shoulder - character looking at other students
Scene 6: Medium shot - character taking first step inside
Scene 7: Close-up - character smiling nervously
Scene 8: Wide shot - character entering classroom

Format each scene as:
SCENE [number]: [Camera angle] - [detailed prompt for image generation including character, setting, action, lighting, and mood. Include how this continues from previous scene]

IMPORTANT: 
- Each scene should have DIFFERENT camera angle
- Create SMOOTH story progression - no skipping steps
- Make it feel like watching a continuous film
- Include specific details about character position, lighting, and atmosphere
- Show the journey step by step, not just key moments`;

    const scenesResponse = await retryWithBackoff(
      () => ai.models.generateContent({
        model: 'freepik-text',
        contents: scenesPrompt
      }),
      (attempt: number) => {
        globalStatusEl.innerHTML = `📝 Creating scenes... (${attempt})`;
      }
    );

    const scenesText = scenesResponse.text;
    console.log('Generated Scenes:', scenesText);

    // Parse scenes from response
    const sceneMatches = scenesText.match(/SCENE \d+:[^]*?(?=SCENE \d+:|$)/gi);
    
    if (!sceneMatches || sceneMatches.length === 0) {
      throw new Error('Failed to generate scenes. Please try again.');
    }

    const scenes = sceneMatches.slice(0, sceneCount);
    console.log(`Generated ${scenes.length} scenes`);

    globalStatusEl.innerHTML = `✨ Generating ${scenes.length} images with consistent character...`;
    globalStatusEl.style.color = '#22c55e';

    // STEP 3: Generate images for each scene with character reference
    // Process in batches of 10 simultaneously
    const BATCH_SIZE = 10;
    
    for (let batchStart = 0; batchStart < scenes.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, scenes.length);
      const batchPromises = [];
      
      globalStatusEl.innerHTML = `✨ Generating batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (scenes ${batchStart + 1}-${batchEnd})...`;
      
      // Create all cards first, then generate in parallel
      for (let i = batchStart; i < batchEnd; i++) {
        const sceneText = scenes[i].trim();
        const scenePrompt = sceneText.replace(/SCENE \d+:\s*/i, '').trim();
        
        // Create result card for this scene
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item filmmaker-scene';
        
        // Scene header
        const sceneHeader = document.createElement('div');
        sceneHeader.className = 'scene-header';
        sceneHeader.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 15px;';
        
        const sceneBadge = document.createElement('span');
        sceneBadge.className = 'scene-badge';
        sceneBadge.style.cssText = 'background: linear-gradient(135deg, #00D4FF 0%, #6B46C1 100%); color: white; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 14px;';
        sceneBadge.textContent = `Scene ${i + 1} of ${scenes.length}`;
        
        sceneHeader.appendChild(sceneBadge);
        resultItem.appendChild(sceneHeader);
        
        // Status element
        const statusEl = document.createElement('p');
        statusEl.className = 'status';
        statusEl.innerHTML = `⏳ Waiting to generate...`;
        statusEl.classList.add('loading');
        resultItem.appendChild(statusEl);
        
        resultsContainer.prepend(resultItem);

        // Create async function for this scene (NO AWAIT HERE - parallel execution)
        const generateScenePromise = (async () => {
          try {
            statusEl.innerHTML = `🎨 Generating scene ${i + 1}...`;
            statusEl.classList.add('loading');
            // Enhanced prompt with character reference
            const enhancedPrompt = `${scenePrompt}\n\nIMPORTANT: The main character MUST look exactly like the person in the reference image. Maintain the same face, hairstyle, clothing style, and overall appearance. Keep the visual style, color grading, and cinematic quality consistent with a professional film production.`;
            
            // Generate image with character reference using Gemini 2.5 Flash Image model
            const imageResponse = await retryWithBackoff(
              () => ai.models.generateContent({
                model: 'freepik-image',
                contents: [
                  {
                    parts: [
                      { text: enhancedPrompt },
                      {
                        inlineData: {
                          data: filmmakerBase64data,
                          mimeType: 'image/png'
                        }
                      }
                    ]
                  }
                ]
              }),
              (attempt: number) => {
                statusEl.innerHTML = `🎨 Generating scene ${i + 1}... (retry ${attempt})`;
              }
            );

            // Extract generated image from response
            let imageData = null;
            for (const part of imageResponse.candidates[0].content.parts) {
              if (part.inlineData) {
                imageData = part.inlineData.data;
                break;
              }
            }

            if (!imageData) {
              throw new Error('No image generated');
            }

            // Create image URL
            const imageUrl = `data:image/png;base64,${imageData}`;
            const filename = `filmmaker-scene-${i + 1}-${Date.now()}.png`;
            generatedAssetUrls.push({url: imageUrl, filename});

            // Clear status and build result card
            statusEl.remove();

            // Delete button
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.innerHTML = '&times;';
            deleteButton.setAttribute('aria-label', 'Delete scene');
            deleteButton.onclick = () => {
              const indexToDelete = generatedAssetUrls.findIndex(
                (v) => v.filename === filename,
              );
              if (indexToDelete > -1) {
                generatedAssetUrls.splice(indexToDelete, 1);
              }
              resultItem.remove();
              
              if (resultsContainer.childElementCount === 1) {
                if (placeholder) placeholder.style.display = 'flex';
              }
            };
            resultItem.appendChild(deleteButton);

            // Prompt display
            const promptDisplay = document.createElement('pre');
            promptDisplay.className = 'card-prompt';
            promptDisplay.textContent = scenePrompt;
            resultItem.appendChild(promptDisplay);

            // Image container
            const imageContainer = document.createElement('div');
            imageContainer.className = 'image-container';
            imageContainer.classList.add('aspect-16-9');
            
            const imgEl = document.createElement('img');
            imgEl.src = imageUrl;
            imgEl.alt = `Scene ${i + 1}`;
            imageContainer.appendChild(imgEl);
            resultItem.appendChild(imageContainer);

            // Actions container
            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'card-actions';

            const downloadButton = document.createElement('button');
            downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Image`;
            downloadButton.className = 'card-button';
            downloadButton.onclick = () => downloadFile(imageUrl, filename);
            actionsContainer.appendChild(downloadButton);
            
            // Generate Video button
            const generateVideoButton = document.createElement('button');
            generateVideoButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Generate Video`;
            generateVideoButton.className = 'card-button';
            generateVideoButton.onclick = async () => {
              // Disable button during generation
              generateVideoButton.disabled = true;
              generateVideoButton.innerHTML = `Generating...`;
              
              try {
                // Replace the current result item content with video generation
                // Save current content in case of error
                const originalContent = resultItem.innerHTML;
                
                // Clear current content and show status
                resultItem.innerHTML = '';
                const videoStatusEl = document.createElement('p');
                videoStatusEl.className = 'status';
                videoStatusEl.innerHTML = ` Generating video from scene ${i + 1}...`;
                videoStatusEl.classList.add('loading');
                resultItem.appendChild(videoStatusEl);
                
                // Generate video with image reference (16:9 landscape)
                await generateAndDisplayVideo(
                  scenePrompt,
                  resultItem,
                  '16:9', // Always use 16:9 landscape for film
                  imageData, // Use the generated image as reference
                  true // Skip voice-over for filmmaker videos
                );
                
              } catch (error) {
                console.error('Failed to generate video:', error);
                generateVideoButton.disabled = false;
                generateVideoButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Generate Video`;
                alert('Failed to generate video. Please try again.');
              }
            };
            actionsContainer.appendChild(generateVideoButton);
            
            resultItem.appendChild(actionsContainer);

            console.log(`✅ Scene ${i + 1} generated successfully`);

          } catch (e) {
            console.error(`Failed to generate scene ${i + 1}:`, e);
            statusEl.innerText = `❌ Error: ${e.message}`;
            statusEl.style.color = '#f472b6';
            statusEl.classList.remove('loading');
          }
        })(); // Execute immediately but don't await
        
        // Add promise to batch
        batchPromises.push(generateScenePromise);
      }
      
      // Wait for ALL scenes in this batch to complete in parallel
      await Promise.all(batchPromises);
      console.log(`✅ Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} completed (scenes ${batchStart + 1}-${batchEnd})`);
      
      // Brief delay between batches
      if (batchEnd < scenes.length) {
        globalStatusEl.innerHTML = `✨ Processing next batch (${batchEnd}/${scenes.length} completed)...`;
        await delay(2000);
      }
    }

    globalStatusEl.innerHTML = `✅ Film created successfully! ${scenes.length} scenes with consistent character.`;
    globalStatusEl.style.color = '#22c55e';
    
    setTimeout(() => {
      globalStatusEl.textContent = '';
      globalStatusEl.style.color = '';
    }, 5000);

  } catch (e) {
    globalStatusEl.innerText = `Film generation failed: ${e.message}`;
    globalStatusEl.style.color = '#f472b6';
    console.error('Film maker generation failed:', e);
  } finally {
    clearOtherModeInputs('filmmaker');
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Set encoded title on page load
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle) {
    // Base64 encode the title to prevent easy modification
    const encodedTitle = btoa('NexaBot Veo 3');
    // Decode and set the title
    heroTitle.textContent = atob(encodedTitle);
  }
  
  startGeneratingBtn.addEventListener('click', async () => {
    heroSection.classList.add('hidden');
    generatorSection.classList.remove('hidden');
    
    // Disable body scrolling when modals are shown
    document.body.style.overflow = 'hidden';
    
    window.scrollTo({top: 0}); // Scroll to the top of the generator
    
    // Show IP check modal first
    ipCheckModal.classList.remove('hidden');
    
    // Start IP detection after a brief delay for effect
    setTimeout(async () => {
      const userIP = await getUserIP();
      
      // Hide loading and show IP
      ipLoading.classList.add('hidden');
      ipDisplay.classList.remove('hidden');
      userIpElement.textContent = userIP;
      
      // Log IP for monitoring (you can send this to your backend)
      console.log(`User IP detected: ${userIP}`);
    }, 1500); // 1.5 second delay for loading effect
  });
  
  // Continue button after IP check
  continueToAccessBtn.addEventListener('click', () => {
    ipCheckModal.classList.add('hidden');
    accessGate.classList.remove('hidden');
  });

  accessForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userName = userNameInput.value.trim();
    const accessCode = accessCodeInput.value.trim();
    
    // Get sharing preference from radio buttons
    const sharingOption = document.querySelector('input[name="sharing"]:checked') as HTMLInputElement;
    sharingEnabled = sharingOption?.value === 'share';
    
    // Use atob for simple obfuscation. 'TkVYQUJPVDk5OQ==' is 'NEXABOT999' in base64.
    const correctCode = atob('TkVYQUJPVDk5OQ==');
    
    if (!userName) {
      accessError.textContent = 'Please enter your name.';
      userNameInput.focus();
      return;
    }
    
    if (accessCode !== correctCode) {
      accessError.textContent = 'Invalid access code. Please try again.';
      accessCodeInput.value = '';
      const content = accessGate.querySelector('.access-gate-content');
      if (content) {
        content.classList.add('shake');
        setTimeout(() => {
          content.classList.remove('shake');
        }, 0.3);
      }
      return;
    }
    
    // Direct verification successful (no Telegram check)
    currentUserName = userName;
    console.log(`User ${userName} logged in successfully with sharing preference: ${sharingEnabled ? 'Share' : 'Keep Private'}`);
    
    // Show success message briefly
    accessError.innerHTML = '<span style="color: #22c55e;">✅ Access granted!</span>';
    
    setTimeout(() => {
      // Re-enable body scrolling
      document.body.style.overflow = 'auto';
      
      accessGate.classList.add('hidden');
      generatorApp.classList.remove('hidden');
    }, 500);
  });

  closeSupportBtn.addEventListener('click', () => {
    supportSection.classList.add('hidden');
  });

  supportSection.addEventListener('click', (e) => {
    // Closes the modal if the click is on the background overlay
    if (e.target === supportSection) {
      supportSection.classList.add('hidden');
    }
  });

  // Mode Dropdown Functionality
  modeDropdownButton.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdownContainer.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    modeDropdownContainer.classList.remove('open');
  });

  // Handle mode selection
  modeDropdownMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const option = (e.target as HTMLElement).closest('.mode-dropdown-option') as HTMLButtonElement;
    if (!option) return;

          const mode = option.dataset.mode as 'manual' | 'film' | 'image' | 'voice' | 'iklan' | 'filmmaker';
    const modeText = option.textContent?.trim() || '';

    // Update active states
    modeDropdownMenu.querySelectorAll('.mode-dropdown-option').forEach(opt => {
      opt.classList.remove('active');
    });
    option.classList.add('active');

    // Update selected text
    selectedModeText.textContent = modeText;

    // Switch modes
    activeMode = mode;
    
    // Hide all panels
    manualModePanel.classList.add('hidden');
    filmModePanel.classList.add('hidden');
    imageModePanel.classList.add('hidden');
    voiceModePanel.classList.add('hidden');
    iklanModePanel.classList.add('hidden');
    filmmakerModePanel.classList.add('hidden');


    // Show selected panel and update button text
    if (mode === 'manual') {
      manualModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate';
    } else if (mode === 'film') {
      filmModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate Storyboard';
    } else if (mode === 'image') {
      imageModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate Images';
    } else if (mode === 'voice') {
      voiceModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate Voice';
    } else if (mode === 'iklan') {
      iklanModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate Iklan';
    } else if (mode === 'filmmaker') {
      filmmakerModePanel.classList.remove('hidden');
      generateButton.textContent = 'Generate Film';
    }

    // Close dropdown
    modeDropdownContainer.classList.remove('open');
  });

  // Aspect Ratio Selectors
  const aspectRatioSelectors = document.querySelectorAll(
    '#aspect-ratio-selector, #film-aspect-ratio-selector, #image-aspect-ratio-selector, #iklan-aspect-ratio-selector',
  );
  aspectRatioSelectors.forEach((selector) => {
    selector.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.tab-button');
      if (!button) return;

      selector.querySelectorAll('.tab-button').forEach((btn) => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });

      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
    });
  });

  imageModelSelect.addEventListener('change', () => {
    const selectedModel = imageModelSelect.value;
    // Enable size selection only for Standard and Ultra models
    if (
      selectedModel.includes('ultra') ||
      selectedModel === 'imagen-4.0-generate-001'
    ) {
      imageSizeSelect.disabled = false;
    } else {
      imageSizeSelect.disabled = true;
      imageSizeSelect.value = '1K'; // Reset to default
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      base64data = await blobToBase64(file);
      const dataUrl = `data:${file.type};base64,${base64data}`;
      imagePreview.src = dataUrl;
      imagePreviewContainer.classList.remove('hidden');
      fileNameEl.textContent = file.name;
    }
  });

  removeImageButton.addEventListener('click', () => {
    base64data = '';
    imagePreviewContainer.classList.add('hidden');
    imagePreview.src = '';
    fileNameEl.textContent = 'Upload Image (Optional)';
    fileInput.value = '';
  });

  // Iklan mode image upload
  iklanFileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      iklanBase64data = await blobToBase64(file);
      const dataUrl = `data:${file.type};base64,${iklanBase64data}`;
      iklanImagePreview.src = dataUrl;
      iklanImagePreviewContainer.classList.remove('hidden');
      // Don't show filename - just keep the upload text clean
    }
  });

  removeIklanImageButton.addEventListener('click', () => {
    iklanBase64data = '';
    iklanImagePreviewContainer.classList.add('hidden');
    iklanImagePreview.src = '';
    iklanFileInput.value = '';
  });
  
  // Film Maker mode image upload
  filmmakerFileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      filmmakerBase64data = await blobToBase64(file);
      const dataUrl = `data:${file.type};base64,${filmmakerBase64data}`;
      filmmakerImagePreview.src = dataUrl;
      filmmakerImagePreviewContainer.classList.remove('hidden');
      filmmakerFileNameEl.textContent = file.name;
    }
  });

  removeFilmmakerImageButton.addEventListener('click', () => {
    filmmakerBase64data = '';
    filmmakerImagePreviewContainer.classList.add('hidden');
    filmmakerImagePreview.src = '';
    filmmakerFileInput.value = '';
    filmmakerFileNameEl.textContent = 'Upload Image Karakter';
  });

  addSceneButton.addEventListener('click', () => {
    sceneCounter++;
    const promptItem = document.createElement('div');
    promptItem.className = 'prompt-item';
    
    const newTextarea = document.createElement('textarea');
    newTextarea.className = 'prompt-input';
    newTextarea.placeholder = `Describe scene ${sceneCounter}...`;
    
    // Create prompt controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'prompt-controls';
    
    // Create enhance button for new scene
    const enhanceButton = document.createElement('button');
    enhanceButton.type = 'button';
    enhanceButton.className = 'enhance-prompt-btn';
    enhanceButton.setAttribute('aria-label', 'Enhance this prompt for better video quality');
    enhanceButton.setAttribute('title', 'AI will enhance your prompt with cinematic details');
    enhanceButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"></path>
      </svg>
      Enhance Prompt
    `;
    
    // Add enhance functionality to new button
    enhanceButton.addEventListener('click', async () => {
      await handleEnhancePrompt(newTextarea, enhanceButton);
    });
    
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    removeButton.className = 'remove-scene-button';
    removeButton.setAttribute('aria-label', `Remove scene ${sceneCounter}`);
    removeButton.onclick = () => promptItem.remove();
    
    controlsContainer.appendChild(enhanceButton);
    controlsContainer.appendChild(removeButton);
    
    promptItem.appendChild(newTextarea);
    promptItem.appendChild(controlsContainer);
    promptsContainer.appendChild(promptItem);
    newTextarea.focus();
  });

  generateButton.addEventListener('click', () => {
    if (activeMode === 'manual') generateManual();
    else if (activeMode === 'film') generateFilm();
    else if (activeMode === 'image') generateImages();
    else if (activeMode === 'voice') generateVoice();
    else if (activeMode === 'iklan') generateIklan();
    else if (activeMode === 'filmmaker') generateFilmMaker();
  });

  // Voice temperature slider
  voiceTemperature.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    temperatureValue.textContent = target.value;
  });



  // Support button
  supportBtn.addEventListener('click', () => {
    window.open('https://www.tiktok.com/@veogentool?_t=ZS-8zC6FZn48RM&_r=1', '_blank');
  });

  // Download all button removed

  // Enhanced prompt functionality
  enhancePromptButton.addEventListener('click', async () => {
    const firstPromptInput = document.querySelector('.prompt-input') as HTMLTextAreaElement;
    await handleEnhancePrompt(firstPromptInput, enhancePromptButton);
  });

  // Prompt Mode Toggle
  if (promptModeToggle) {
    promptModeToggle.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.toggle-btn') as HTMLButtonElement;
      if (!button) return;

      const mode = button.dataset.mode as 'single' | 'batch';
      if (!mode) return;

      // Update active state
      promptModeToggle.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.remove('active');
      });
      button.classList.add('active');

      // Update global prompt mode
      promptMode = mode;

      // Update UI based on mode
      const promptInput = document.querySelector('#manual-mode-panel .prompt-input') as HTMLTextAreaElement;
      const addSceneBtn = document.querySelector('#add-scene-button') as HTMLButtonElement;
      const enhanceBtn = document.querySelector('#enhance-prompt-button') as HTMLButtonElement;
      
      if (mode === 'single') {
        // Single mode: show add scene button and enhance button
        promptModeInfo.textContent = 'Create a single video with one or multiple scenes';
        promptInput.placeholder = 'A robot holding a red skateboard.';
        promptInput.rows = 3;
        addSceneBtn.style.display = 'flex';
        enhanceBtn.style.display = 'flex';
        
        // Clear extra prompt items if any
        const extraPromptItems = document.querySelectorAll('#manual-mode-panel .prompt-item:not(:first-child)');
        extraPromptItems.forEach(item => item.remove());
      } else {
        // Batch mode: hide add scene button, show batch prompt instructions
        promptModeInfo.textContent = 'Generate multiple videos at once - separate each prompt with a new line (Enter)';
        promptInput.placeholder = 'First video prompt\n\nSecond video prompt\n\nThird video prompt';
        promptInput.rows = 8;
        addSceneBtn.style.display = 'none';
        enhanceBtn.style.display = 'none';
        
        // Clear extra prompt items
        const extraPromptItems = document.querySelectorAll('#manual-mode-panel .prompt-item:not(:first-child)');
        extraPromptItems.forEach(item => item.remove());
        
        // Clear the input
        promptInput.value = '';
      }
    });
  }
}

// Generation Flow Controllers
function generateManual() {
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';
  
  if (placeholder) placeholder.style.display = 'none';

  const aspectRatioSelector = document.querySelector(
    '#aspect-ratio-selector .tab-button.active',
  ) as HTMLButtonElement;
  const aspectRatio = aspectRatioSelector.dataset.ratio ?? '16:9';

  // Check if we're in batch mode or single mode
  if (promptMode === 'batch') {
    // Batch mode: parse multiple prompts separated by empty lines
    const promptTextarea = document.querySelector(
      '#manual-mode-panel .prompt-input',
    ) as HTMLTextAreaElement;
    
    const allText = promptTextarea.value.trim();
    if (!allText) {
      globalStatusEl.innerText = 'Please enter at least one prompt.';
      return;
    }
    
    // Split by double newlines (empty lines) to get individual prompts
    const batchPrompts = allText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
    
    if (batchPrompts.length === 0) {
      globalStatusEl.innerText = 'Please enter at least one prompt.';
      return;
    }
    
    // Show status for batch processing
    globalStatusEl.innerHTML = `🎬 Generating ${batchPrompts.length} videos...`;
    globalStatusEl.style.color = '#00D4FF';
    
    // Generate videos for each prompt in batch
    let processedCount = 0;
    batchPrompts.forEach((prompt, index) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      
      // Add batch indicator
      const batchIndicator = document.createElement('div');
      batchIndicator.className = 'batch-indicator';
      batchIndicator.style.cssText = 'background: linear-gradient(135deg, #00D4FF, #6B46C1); color: white; padding: 4px 12px; border-radius: 20px; display: inline-block; font-size: 12px; font-weight: 600; margin-bottom: 8px;';
      batchIndicator.textContent = `Video ${index + 1} of ${batchPrompts.length}`;
      resultItem.appendChild(batchIndicator);
      
      const statusEl = document.createElement('p');
      statusEl.className = 'status';
      statusEl.innerHTML = ' Please Wait...';
      resultItem.appendChild(statusEl);
      resultsContainer.prepend(resultItem);

      // Generate each video with a slight delay to avoid overwhelming the API
      setTimeout(() => {
        generateAndDisplayVideo(
          prompt,
          resultItem,
          aspectRatio,
          base64data || null,
        ).then(() => {
          processedCount++;
          if (processedCount === batchPrompts.length) {
            globalStatusEl.innerHTML = `✅ Successfully generated ${processedCount} videos!`;
            globalStatusEl.style.color = '#10B981';
            setTimeout(() => {
              globalStatusEl.textContent = '';
              globalStatusEl.style.color = '';
            }, 5000);
          }
        }).catch((error) => {
          console.error(`Failed to generate video ${index + 1}:`, error);
          processedCount++;
          if (processedCount === batchPrompts.length) {
            globalStatusEl.innerHTML = `⚠️ Batch processing completed with some errors`;
            globalStatusEl.style.color = '#EC4899';
          }
        });
      }, index * 500); // 500ms delay between each video generation start
    });
    
  } else {
    // Single mode: existing logic for combining multiple scenes into one video
    const promptInputs = document.querySelectorAll(
      '#manual-mode-panel .prompt-input',
    ) as NodeListOf<HTMLTextAreaElement>;
    const prompts = Array.from(promptInputs)
      .map((input) => input.value.trim())
      .filter((p) => p.length > 0);

    if (prompts.length === 0) {
      globalStatusEl.innerText = 'Please describe at least one scene.';
      return;
    }

    const combinedPrompt = prompts.join('. Then, a new scene of ');
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    const statusEl = document.createElement('p');
    statusEl.className = 'status';
    statusEl.innerHTML = ' Please Wait...';
    resultItem.appendChild(statusEl);
    resultsContainer.prepend(resultItem);

    generateAndDisplayVideo(
      combinedPrompt,
      resultItem,
      aspectRatio,
      base64data || null,
    );
  }
  
  // Clear other mode inputs to prevent cross-contamination
  clearOtherModeInputs('manual');
}

async function generateFilm() {
  const topic = filmTopicInput.value.trim();
  const sceneCount = parseInt(sceneCountInput.value, 10);
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';

  if (!topic || isNaN(sceneCount) || sceneCount < 1) {
    globalStatusEl.innerText =
      'Please enter a valid film topic and number of scenes.';
    return;
  }

  globalStatusEl.innerHTML = ' Please Wait...';
  if (placeholder) placeholder.style.display = 'none';

  const filmAspectRatioSelector = document.querySelector(
    '#film-aspect-ratio-selector .tab-button.active',
  ) as HTMLButtonElement;
  const aspectRatio = filmAspectRatioSelector.dataset.ratio ?? '16:9';

  try {
    const apiKey = process.env.FREEPIK_API_KEY;
    if (!apiKey) throw new Error('API Key is missing.');

    const ai = new FreepikClient({apiKey});

    setLoadingState(globalStatusEl, '🎬 Discovering Freepik inspiration');

    // Enhanced prompt for story generation
    const storyPrompt = `${STORYBOARD_DIRECTOR_PROMPT}

User Request: "${topic}"
Number of Scenes Required: ${sceneCount}

IMPORTANT INSTRUCTIONS:
1. Create exactly ${sceneCount} scenes, each 8 seconds long
2. Develop engaging characters with FULL physical descriptions that remain IDENTICAL across all scenes
3. Establish a clear visual style in Scene 1 and maintain it throughout
4. Each scene must flow naturally from the previous one
5. Focus on visual storytelling - NO dialogue or speech
6. Include specific camera angles and movements for cinematic effect

Generate ${sceneCount} detailed scene prompts following the format specified above. Make sure to tell a complete story arc with beginning, middle, and end.`;

    const storyResponse = await retryWithBackoff(
      () => ai.models.generateContent({
        model: 'freepik-text',
        contents: storyPrompt
      }),
      (attempt: number) => {
        globalStatusEl.innerHTML = `🎬 Creating your story with AI Director... (${attempt})`;
      }
    );

    const fullContent = storyResponse.text;
    
    if (!fullContent) {
      throw new Error('No content generated. Please try again.');
    }

    console.log('Generated Story:', fullContent);

    // Parse scenes from the response
    const sceneMatches = fullContent.match(/Scene \d+:[^]*?(?=Scene \d+:|$)/gi);
    
    if (!sceneMatches || sceneMatches.length === 0) {
      // Try alternative parsing if Scene X: format not found
      const altSceneMatches = fullContent.split(/\n\n+/).filter(text => 
        text.length > 100 && (text.includes('8-second') || text.includes('8 second') || text.includes('camera') || text.includes('scene'))
      );
      
      if (altSceneMatches && altSceneMatches.length > 0) {
        // Use alternative matches
        const scenes = altSceneMatches.slice(0, sceneCount);
        console.log(`Found ${scenes.length} scenes using alternative parsing`);
        globalStatusEl.innerHTML = '';
        
        // Process scenes with alternative parsing
        for (let i = 0; i < scenes.length; i++) {
          createSceneCard(scenes[i].trim(), i, aspectRatio, resultsContainer);
        }
        
        // Show completion message
        globalStatusEl.innerHTML = `✨ Storyboard created successfully! ${scenes.length} scenes ready for video generation.`;
        globalStatusEl.style.color = '#22c55e';
        return;
      }
      
      throw new Error('Failed to parse scenes from generated content. Please try again.');
    }

    // Take only the requested number of scenes
    const scenes = sceneMatches.slice(0, sceneCount);
    
    globalStatusEl.innerHTML = '';
    
    // Create scene cards with improved UI
    for (let i = 0; i < scenes.length; i++) {
      createSceneCard(scenes[i].trim(), i, aspectRatio, resultsContainer);
    }
    
    // Show completion message
    globalStatusEl.innerHTML = `✨ Storyboard created successfully! ${scenes.length} scenes ready for video generation.`;
    globalStatusEl.style.color = '#22c55e';
    
  } catch (e) {
    globalStatusEl.innerText = `Storyboard generation failed: ${e.message}`;
    globalStatusEl.style.color = '#f472b6';
    console.error('Storyboard generation failed:', e);
  } finally {
    // Clear other mode inputs to prevent cross-contamination
    clearOtherModeInputs('film');
  }
}

// Helper function to create scene card UI
function createSceneCard(scenePrompt: string, sceneIndex: number, aspectRatio: string, container: HTMLElement) {
      const i = sceneIndex;
      
      // Create scene card
      const sceneCard = document.createElement('div');
      sceneCard.className = 'result-item storyboard-scene';
      sceneCard.style.position = 'relative';
      
      // Scene header with number badge
      const sceneHeader = document.createElement('div');
      sceneHeader.className = 'scene-header';
      sceneHeader.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 15px;';
      
      const sceneBadge = document.createElement('span');
      sceneBadge.className = 'scene-badge';
      sceneBadge.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 14px;';
      sceneBadge.textContent = `Scene ${i + 1}`;
      
      const sceneTitle = document.createElement('span');
      sceneTitle.style.cssText = 'color: #9ca3af; font-size: 14px;';
      sceneTitle.textContent = `Duration: 8 seconds`;
      
      sceneHeader.appendChild(sceneBadge);
      sceneHeader.appendChild(sceneTitle);
      sceneCard.appendChild(sceneHeader);
      
      // Prompt container with better styling
      const promptContainer = document.createElement('div');
      promptContainer.className = 'prompt-container';
      promptContainer.style.cssText = 'background: rgba(30, 30, 40, 0.5); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 20px; position: relative;';
      
      // Copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-prompt-btn';
      copyButton.style.cssText = 'position: absolute; top: 10px; right: 10px; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.5); color: #a78bfa; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; transition: all 0.3s;';
      copyButton.innerHTML = `📋 Copy Prompt`;
      copyButton.onmouseover = () => {
        copyButton.style.background = 'rgba(139, 92, 246, 0.3)';
        copyButton.style.transform = 'scale(1.05)';
      };
      copyButton.onmouseout = () => {
        copyButton.style.background = 'rgba(139, 92, 246, 0.2)';
        copyButton.style.transform = 'scale(1)';
      };
      copyButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(scenePrompt);
          const originalText = copyButton.innerHTML;
          copyButton.innerHTML = '✅ Copied!';
          copyButton.style.color = '#22c55e';
          setTimeout(() => {
            copyButton.innerHTML = originalText;
            copyButton.style.color = '#a78bfa';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      };
      
      const promptText = document.createElement('pre');
      promptText.className = 'scene-prompt-text';
      promptText.style.cssText = 'white-space: pre-wrap; word-wrap: break-word; margin: 0; color: #e5e7eb; font-size: 14px; line-height: 1.6; font-family: "Space Grotesk", monospace; max-height: 300px; overflow-y: auto;';
      promptText.textContent = scenePrompt;
      
      promptContainer.appendChild(copyButton);
      promptContainer.appendChild(promptText);
      sceneCard.appendChild(promptContainer);
      
      // Video generation section
      const videoSection = document.createElement('div');
      videoSection.className = 'video-generation-section';
      videoSection.style.cssText = 'margin-top: 20px;';
      
      // Generate button for this specific scene
      const generateSceneBtn = document.createElement('button');
      generateSceneBtn.className = 'generate-scene-btn';
      generateSceneBtn.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.3s; width: 100%; margin-bottom: 15px;';
      generateSceneBtn.innerHTML = `🎬 Generate Video for Scene ${i + 1}`;
      generateSceneBtn.onmouseover = () => {
        generateSceneBtn.style.transform = 'translateY(-2px)';
        generateSceneBtn.style.boxShadow = '0 10px 25px rgba(139, 92, 246, 0.3)';
      };
      generateSceneBtn.onmouseout = () => {
        generateSceneBtn.style.transform = 'translateY(0)';
        generateSceneBtn.style.boxShadow = 'none';
      };
      
      // Video container (initially hidden)
      const videoContainer = document.createElement('div');
      videoContainer.className = 'scene-video-container';
      videoContainer.style.cssText = 'display: none;';
      
  // Handle generate button click
      generateSceneBtn.onclick = async () => {
        generateSceneBtn.disabled = true;
        generateSceneBtn.style.opacity = '0.5';
        generateSceneBtn.style.cursor = 'not-allowed';
        
        // Create progress status element with better styling
        const statusEl = document.createElement('div');
        statusEl.className = 'scene-generation-status';
        statusEl.style.cssText = 'background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 8px; padding: 15px; margin-top: 10px; text-align: center;';
        statusEl.innerHTML = `
          <div class="status-content" style="display: flex; align-items: center; justify-content: center; gap: 10px;">
            <div class="loading-spinner" style="width: 20px; height: 20px; border: 2px solid rgba(139, 92, 246, 0.3); border-top-color: #8b5cf6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span style="color: #a78bfa; font-weight: 500;">Generating Scene ${i + 1}...</span>
          </div>
        `;
        videoContainer.appendChild(statusEl);
        videoContainer.style.display = 'block';
        
        // Add CSS animation for spinner if not already present
        if (!document.querySelector('#spinner-animation')) {
          const style = document.createElement('style');
          style.id = 'spinner-animation';
          style.textContent = `
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `;
          document.head.appendChild(style);
        }
        
        // Create a temporary result item for video generation
        const tempResultItem = document.createElement('div');
        const tempStatusEl = document.createElement('p');
        tempStatusEl.className = 'status';
        tempResultItem.appendChild(tempStatusEl);
        
        // Update progress messages during generation
        let progressInterval = setInterval(() => {
          const messages = [
            `🎬 Generating Scene ${i + 1}...`,
            `🎨 Processing visuals for Scene ${i + 1}...`,
            `✨ Rendering Scene ${i + 1}...`,
            `🔄 Almost ready with Scene ${i + 1}...`
          ];
          const randomMessage = messages[Math.floor(Date.now() / 2000) % messages.length];
          const statusContent = statusEl.querySelector('.status-content span');
          if (statusContent) {
            statusContent.textContent = randomMessage;
          }
        }, 2000);
        
        try {
          // Generate video with auto-retry
          await generateAndDisplayVideo(scenePrompt, tempResultItem, aspectRatio);
          
          // Clear progress interval
          clearInterval(progressInterval);
          
          // Move generated content to our video container
          videoContainer.innerHTML = '';
          while (tempResultItem.firstChild) {
            videoContainer.appendChild(tempResultItem.firstChild);
          }
          
          // Hide generate button after successful generation
          generateSceneBtn.style.display = 'none';
        } catch (error) {
          clearInterval(progressInterval);
          console.error(`Failed to generate video for scene ${i + 1}:`, error);
          statusEl.innerHTML = `<span style="color: #f472b6;">❌ Failed to generate video: ${error.message}</span>`;
          generateSceneBtn.disabled = false;
          generateSceneBtn.style.opacity = '1';
          generateSceneBtn.style.cursor = 'pointer';
        }
      };
      
      videoSection.appendChild(generateSceneBtn);
      videoSection.appendChild(videoContainer);
      sceneCard.appendChild(videoSection);
      
      // Add to results container
      container.appendChild(sceneCard);
}

async function generateIklan() {
  const selectedLanguage = iklanLanguageSelect.value;
  const selectedVoice = iklanVoiceSelect.value;
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';

  if (!iklanBase64data) {
    globalStatusEl.innerText = 'Silakan upload gambar produk terlebih dahulu.';
    return;
  }

  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) {
    globalStatusEl.innerText =
      'Error: API Key is not configured. Please contact the administrator.';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  // Create result item immediately with iklan-specific class
  const resultItem = document.createElement('div');
  resultItem.className = 'result-item iklan-result';
  const statusEl = document.createElement('p');
  statusEl.className = 'status';
      setLoadingState(statusEl, 'Analyzing image');
  resultItem.appendChild(statusEl);
  resultsContainer.prepend(resultItem);

  try {
    const ai = new FreepikClient({apiKey});
    
    // Get aspect ratio
    const iklanAspectRatioSelector = document.querySelector(
      '#iklan-aspect-ratio-selector .tab-button.active',
    ) as HTMLButtonElement;
    const aspectRatio = iklanAspectRatioSelector.dataset.ratio ?? '16:9';
    
    // Analyze image with Gemini Flash
    const analysisPrompt = `Analyze this product image and create an engaging advertisement script. 

Instructions:
- Identify the product/service in the image
- Create a compelling advertisement script in ${selectedLanguage === 'id-ID' ? 'Indonesian' : selectedLanguage === 'en-US' ? 'English' : selectedLanguage === 'ms-MY' ? 'Malay' : selectedLanguage === 'zh-CN' ? 'Chinese' : selectedLanguage === 'ja-JP' ? 'Japanese' : 'Korean'}
- CRITICAL: Voiceover script must be MAXIMUM 8 words for perfect 8-second video timing
- Focus on ONE key benefit or emotional appeal only
- Make it punchy, memorable, and impactful
- Keep the tone engaging and persuasive

Return response in this format:
PRODUCT: [product name]
VIDEO_PROMPT: [detailed video generation prompt describing scenes, actions, and visual elements for 8-second video]
VOICEOVER_SCRIPT: [maximum 8 words punchy advertisement script for voiceover]`;

    const analysisResponse = await retryWithBackoff(
      () => ai.models.generateContent({
      model: 'freepik-text',
      contents: [
        {
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                data: iklanBase64data,
                mimeType: 'image/png'
              }
            }
          ]
        }
      ]
      }),
      (attempt: number) => {
        statusEl.innerHTML = ` Analyzing image... (${attempt})`;
      }
    );

    const analysisText = analysisResponse.text;
    console.log('Analysis response:', analysisText);

    // Extract video prompt and voiceover script
    const videoPromptMatch = analysisText.match(/VIDEO_PROMPT:\s*(.+?)(?=\n\w+:|$)/s);
    const voiceoverMatch = analysisText.match(/VOICEOVER_SCRIPT:\s*(.+?)(?=\n\w+:|$)/s);
    
    const videoPrompt = videoPromptMatch ? videoPromptMatch[1].trim() : analysisText;
    let voiceoverScript = voiceoverMatch ? voiceoverMatch[1].trim() : analysisText;
    
    // Ensure voiceover script is maximum 8 words for perfect 8-second timing
    const words = voiceoverScript.split(' ').filter(word => word.length > 0);
    if (words.length > 8) {
      voiceoverScript = words.slice(0, 8).join(' ');
      console.log(`Voiceover script trimmed to 8 words: "${voiceoverScript}"`);
    }

    // Update status in existing card
    setLoadingState(statusEl, 'Generating video & voiceover');

    // Generate VIDEO and AUDIO in PARALLEL for faster processing
    const videoPromise = generateAndDisplayVideo(
      videoPrompt,
      resultItem,
      aspectRatio,
      iklanBase64data,
    );

    // Generate audio only if script has 3-8 words (optimal for 8-second video)
    const wordCount = voiceoverScript.split(' ').filter(word => word.length > 0).length;
    const audioPromise = (voiceoverScript && wordCount >= 3 && wordCount <= 8) ? 
      generateNaturalTTSAudio(voiceoverScript, selectedVoice, selectedLanguage, analysisText) : 
      Promise.resolve(null);
    
    if (wordCount < 3) {
      console.log('Voiceover script too short (<3 words), skipping audio generation');
    }

    // Wait for both video and audio to complete
    try {
      const [videoResult, audioData] = await Promise.all([videoPromise, audioPromise]);
      
      // Integrate audio with video after both are ready
      if (audioData) {
        const audioContainer = resultItem.querySelector('.audio-container');
        const videoEl = resultItem.querySelector('video');
        
        if (audioContainer && videoEl) {
          // Replace the existing audio container content
          audioContainer.innerHTML = '';
          
          const audioEl = document.createElement('audio');
          audioEl.controls = false; // Hide audio controls since it will be synced with video
          audioEl.src = audioData.url;
          audioEl.volume = 0.8; // Slightly lower volume for better mix
          audioContainer.appendChild(audioEl);

          // Auto-sync audio with video playback
          videoEl.addEventListener('play', () => {
            audioEl.currentTime = videoEl.currentTime;
            audioEl.play();
          });
          
          videoEl.addEventListener('pause', () => {
            audioEl.pause();
          });
          
          videoEl.addEventListener('seeked', () => {
            audioEl.currentTime = videoEl.currentTime;
          });
          
          videoEl.addEventListener('ended', () => {
            audioEl.pause();
            audioEl.currentTime = 0;
          });

          // Show sync status
          const syncStatus = document.createElement('div');
          syncStatus.className = 'sync-status';
          syncStatus.innerHTML = '🔊 Audio terintegrasi dengan video';
          audioContainer.appendChild(syncStatus);

          // Add download audio button
          const downloadAudioButton = document.createElement('button');
          downloadAudioButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Audio`;
          downloadAudioButton.className = 'card-button';
          downloadAudioButton.onclick = () =>
            downloadFile(audioData.url, audioData.filename);
          
          const actionsContainer = resultItem.querySelector('.card-actions');
          if (actionsContainer) {
            actionsContainer.prepend(downloadAudioButton);
          }

          generatedAssetUrls.push({url: audioData.url, filename: audioData.filename});
        }
      }

      
    } catch (e) {
      console.error('Parallel generation failed:', e);
      const audioContainer = resultItem.querySelector('.audio-container');
      if (audioContainer) {
        audioContainer.innerHTML = '<p class="status-error">Audio generation failed</p>';
      }
    }

  } catch (e) {
    statusEl.innerText = `Error: ${e.message}`;
    statusEl.style.color = '#f472b6';
    console.error('Iklan generation failed:', e);
  }
}





async function generateVoice() {
  const scriptText = voiceScriptInput.value.trim();
  const selectedVoice = voiceSelect.value;
  const temperature = parseFloat(voiceTemperature.value);
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';

  if (!scriptText) {
    globalStatusEl.innerText = 'Please enter a script to generate voice.';
    return;
  }

  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) {
    globalStatusEl.innerText =
      'Error: API Key is not configured. Please contact the administrator.';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  // Create result item with processing status first
  const resultItem = document.createElement('div');
  resultItem.className = 'result-item';
  
  const statusEl = document.createElement('p');
  statusEl.className = 'status';
  setLoadingState(statusEl, 'Generating voice');
  resultItem.appendChild(statusEl);
  
  resultsContainer.prepend(resultItem);

  const onRetryCallback = (attempt: number) => {
    setLoadingState(statusEl, '', true, attempt);
  };

  try {
    setLoadingState(statusEl, 'Generating voice');
    const audioData = await retryWithBackoff(
      () => generateTTSAudio(scriptText, selectedVoice, temperature),
      onRetryCallback,
    );
    
    if (audioData) {
      // Clear processing status and set up the result
      resultItem.innerHTML = '';
      resultItem.dataset.filename = audioData.filename;

      // Create Delete Button
      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-button';
      deleteButton.innerHTML = '&times;';
      deleteButton.setAttribute('aria-label', 'Delete audio');
      deleteButton.onclick = () => {
        const filenameToDelete = resultItem.dataset.filename;
        const indexToDelete = generatedAssetUrls.findIndex(
          (v) => v.filename === filenameToDelete,
        );
        if (indexToDelete > -1) {
          generatedAssetUrls.splice(indexToDelete, 1);
        }
        resultItem.remove();

        if (resultsContainer.childElementCount === 1) { // only placeholder is left
          placeholder.style.display = 'flex';
        }
        
        // Download all button removed
      };

      // Voice info display
      const voiceInfoDisplay = document.createElement('div');
      voiceInfoDisplay.className = 'voice-info';
      voiceInfoDisplay.innerHTML = `
        <div class="voice-details">
          <strong>Voice:</strong> ${selectedVoice} | <strong>Temperature:</strong> ${temperature}
        </div>
        <div class="script-preview">${scriptText}</div>
      `;

      // Audio container
      const audioContainer = document.createElement('div');
      audioContainer.className = 'audio-container';
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.src = audioData.url;
      audioContainer.appendChild(audioEl);

      // Actions container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'card-actions';

      const downloadButton = document.createElement('button');
      downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Audio`;
      downloadButton.className = 'card-button';
      downloadButton.onclick = () => downloadFile(audioData.url, audioData.filename);

      actionsContainer.appendChild(downloadButton);
      
      resultItem.appendChild(deleteButton);
      resultItem.appendChild(voiceInfoDisplay);
      resultItem.appendChild(audioContainer);
      resultItem.appendChild(actionsContainer);

      generatedAssetUrls.push({url: audioData.url, filename: audioData.filename});
      
      // Download all button removed
    } else {
      statusEl.innerText = 'Failed to generate voice audio. Please try again.';
      statusEl.style.color = '#f472b6';
    }
  } catch (e) {
    statusEl.innerText = `Error: ${e.message}`;
    statusEl.style.color = '#f472b6';
    console.error('Voice generation failed:', e);
  } finally {
    // Clear other mode inputs to prevent cross-contamination
    clearOtherModeInputs('voice');
  }
}







// Scroll Header Effect
function handleHeaderScroll() {
  const header = document.querySelector('header') as HTMLElement;
  if (window.scrollY > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
}

// Add scroll event listener
window.addEventListener('scroll', handleHeaderScroll);

// Prevent scrolling during access gate
function preventScroll(e: Event) {
  if (!accessGate.classList.contains('hidden')) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}

// Add scroll prevention event listeners
document.addEventListener('wheel', preventScroll, { passive: false });
document.addEventListener('touchmove', preventScroll, { passive: false });
document.addEventListener('keydown', (e) => {
  if (!accessGate.classList.contains('hidden')) {
    // Prevent arrow keys, space, page up/down from scrolling
    if ([32, 33, 34, 35, 36, 37, 38, 39, 40].includes(e.keyCode)) {
      e.preventDefault();
      return false;
    }
  }
});

// Handle enhance prompt functionality
async function handleEnhancePrompt(textarea: HTMLTextAreaElement, button: HTMLButtonElement) {
  const originalPrompt = textarea.value.trim();
  
  if (!originalPrompt) {
    globalStatusEl.innerText = 'Please enter a prompt first before enhancing.';
    globalStatusEl.style.color = '#f472b6';
    setTimeout(() => {
      globalStatusEl.innerText = '';
      globalStatusEl.style.color = '';
    }, 3000);
    return;
  }

  // Show loading state
  const originalButtonHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `

    Enhancing...
  `;

  try {
    const enhancedPrompt = await enhanceVideoPrompt(originalPrompt);
    
    if (enhancedPrompt !== originalPrompt) {
      // Animate the text replacement
      textarea.style.opacity = '0.5';
      textarea.style.transform = 'scale(0.98)';
      textarea.style.transition = 'all 0.3s ease';
      
      setTimeout(() => {
        textarea.value = enhancedPrompt;
        textarea.style.opacity = '1';
        textarea.style.transform = 'scale(1)';
        
        // Show success feedback
        globalStatusEl.innerText = '✨ Prompt enhanced successfully!';
        globalStatusEl.style.color = '#22c55e';
        setTimeout(() => {
          globalStatusEl.innerText = '';
          globalStatusEl.style.color = '';
        }, 3000);
      }, 300);
    } else {
      throw new Error('Enhancement failed or returned same prompt');
    }
  } catch (error) {
    console.error('Failed to enhance prompt:', error);
    globalStatusEl.innerText = 'Failed to enhance prompt. Please try again.';
    globalStatusEl.style.color = '#f472b6';
    setTimeout(() => {
      globalStatusEl.innerText = '';
      globalStatusEl.style.color = '';
    }, 3000);
  } finally {
    // Restore button
    button.disabled = false;
    button.innerHTML = originalButtonHTML;
  }
}

// App Initialization
setupEventListeners();

// Ensure proper scroll behavior on page load
if (!generatorSection.classList.contains('hidden') && !accessGate.classList.contains('hidden')) {
  document.body.style.overflow = 'hidden';
}
