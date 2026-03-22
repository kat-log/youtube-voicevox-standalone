import type { YouTubeVideoResponse, YouTubeChatResponse } from '@/types/api-responses';

export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.youtube.com') {
      return new URLSearchParams(parsed.search).get('v');
    } else if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
  } catch {
    // URL解析失敗
  }
  return null;
}

export async function fetchLiveChatId(videoId: string, apiKey: string): Promise<string> {
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails,snippet&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('YouTube APIレート制限（403）');
    }
    throw new Error(`YouTube APIリクエストに失敗しました（${response.status}）。`);
  }

  const data: YouTubeVideoResponse = await response.json();

  // デバッグ情報をコンソールに出力
  // eslint-disable-next-line no-console
  console.log('YouTube API Response:', data);
  // eslint-disable-next-line no-console
  console.log('Video Details:', data.items?.[0]);
  // eslint-disable-next-line no-console
  console.log('LiveStreamingDetails:', data.items?.[0]?.liveStreamingDetails);

  if (!data.items || data.items.length === 0) {
    throw new Error('動画情報が見つかりません。');
  }

  const videoDetails = data.items[0];

  if (!videoDetails.liveStreamingDetails) {
    throw new Error('この動画はライブ配信ではありません。');
  }

  const liveChatId = videoDetails.liveStreamingDetails.activeLiveChatId;
  if (!liveChatId) {
    const error = new Error(
      'このライブ配信ではチャットを取得できません。チャットが無効になっている可能性があります。'
    ) as Error & { details?: unknown };
    error.details = videoDetails.liveStreamingDetails;
    throw error;
  }

  return liveChatId;
}

export async function fetchChatMessages(
  liveChatId: string,
  apiKey: string,
  pageToken: string | null
): Promise<YouTubeChatResponse> {
  let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKey}`;
  if (pageToken) {
    url += `&pageToken=${pageToken}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 403) {
      // 配信終了の検出: liveChatEnded reason をチェック
      try {
        const errorData = await response.json();
        if (
          errorData?.error?.errors?.some((e: { reason: string }) => e.reason === 'liveChatEnded')
        ) {
          throw new LiveChatEndedError('ライブ配信が終了しました。');
        }
      } catch (e) {
        if (e instanceof LiveChatEndedError) throw e;
        // JSONパース失敗は無視してレート制限として扱う
      }
      // liveChatEnded以外の403はレート制限
      const rateLimitError = new Error('YouTube APIレート制限（403）') as Error & {
        isRateLimit: boolean;
      };
      rateLimitError.isRateLimit = true;
      throw rateLimitError;
    }
    throw new Error(`YouTube APIリクエストに失敗しました（${response.status}）。`);
  }

  return response.json();
}

export class LiveChatEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveChatEndedError';
  }
}
