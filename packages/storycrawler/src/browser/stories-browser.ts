import { BaseBrowser, BaseBrowserOptions } from './base-browser';
import { Logger } from '../logger';
import { NoStoriesError } from '../errors';
import { Story, StoryKind, V5Story } from '../story-types';
import { flattenStories } from '../flatten-stories';
import { StorybookConnection } from '../storybook-connection';

interface API {
  store?: () => {
    _configuring?: boolean; // available SB v6 or later
  };
  raw?: () => { id: string; kind: string; name: string }[]; // available SB v5 or later
  getStorybook(): { kind: string; stories: { name: string }[] }[]; // for legacy (SB v4) API
}

type ExposedWindow = typeof window & {
  __STORYBOOK_CLIENT_API__: API;
};

const MAX_CONFIGURE_WAIT_COUNT = 100;

/**
 *
 * Browser class to fetch all stories names.
 *
 **/
export class StoriesBrowser extends BaseBrowser {
  /**
   *
   * @param connection Connected connection to the target Storybook server
   * @param opt Options to launch browser
   * @param logger Logger instance
   *
   **/
  constructor(
    protected connection: StorybookConnection,
    protected opt: BaseBrowserOptions = {},
    protected logger: Logger = new Logger('silent'),
  ) {
    super(opt);
  }

  /**
   *
   * Fetches stories' id, kind and names
   *
   * @returns List of stories
   *
   * @remarks
   * This method automatically detects version of the Storybook.
   *
   **/
  async getStories() {
    this.logger.debug('Wait for stories definition.');
    await this.page.goto(this.connection.url);
    let stories: Story[] | null = null;
    let oldStories: StoryKind[] | null = null;
    await this.page.goto(
      this.connection.url + '/iframe.html?selectedKind=story-crawler-kind&selectedStory=story-crawler-story',
      {
        timeout: 60_000,
        waitUntil: 'domcontentloaded',
      },
    );
    await this.page.waitForFunction(() => (window as ExposedWindow).__STORYBOOK_CLIENT_API__);
    const result = await this.page.evaluate(
      () =>
        new Promise<{ stories: V5Story[] | null; oldStories: StoryKind[] | null }>(res => {
          const getStories = (count = 0) => {
            const { __STORYBOOK_CLIENT_API__: api } = window as ExposedWindow;
            if (api.raw) {
              // for Storybook v6
              const configuring = api.store && api.store()._configuring;
              if (configuring && count < MAX_CONFIGURE_WAIT_COUNT) {
                setTimeout(() => getStories(++count), 16);
                return;
              }
              // for Storybook v5
              const stories = api.raw().map(_ => ({ id: _.id, kind: _.kind, story: _.name, version: 'v5' } as V5Story));
              res({ stories, oldStories: null });
            } else {
              // for Storybook v4
              const oldStories = api
                .getStorybook()
                .map(({ kind, stories }) => ({ kind, stories: stories.map(s => s.name) }));
              res({ stories: null, oldStories });
            }
          };
          getStories();
        }),
    );
    stories = result.stories;
    oldStories = result.oldStories;
    if (oldStories) {
      stories = flattenStories(oldStories);
    }
    if (!stories) {
      throw new NoStoriesError();
    }
    this.logger.debug(stories);
    return stories;
  }
}
