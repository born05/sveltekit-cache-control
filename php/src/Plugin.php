<?php

namespace born05\craftcachecontrol;

use Craft;
use born05\craftcachecontrol\models\Settings;
use craft\base\Element;
use craft\base\Event;
use craft\base\Model;
use craft\base\Plugin as BasePlugin;
use craft\events\ModelEvent;
use craft\helpers\ElementHelper;
use craft\helpers\StringHelper;

/**
 * Cache control plugin
 *
 * @method static Plugin getInstance()
 * @method Settings getSettings()
 */
class Plugin extends BasePlugin
{
    public string $schemaVersion = '1.0.0';
    public bool $hasCpSettings = true;

    public static function config(): array
    {
        return [
            'components' => [
                // Define component configs here...
            ],
        ];
    }

    public function init(): void
    {
        parent::init();

        Craft::$app->onInit(function () {
            $this->attachEventHandlers();
        });
    }

    protected function createSettingsModel(): ?Model
    {
        return Craft::createObject(Settings::class);
    }

    protected function settingsHtml(): ?string
    {
        return Craft::$app->view->renderTemplate('cache-control/_settings.twig', [
            'plugin' => $this,
            'settings' => $this->getSettings(),
        ]);
    }

    private function attachEventHandlers(): void
    {
        Event::on(Element::class, Element::EVENT_AFTER_SAVE, function (ModelEvent $event) {
            /** @var Element */
            $element = $event->sender;

            if (
                !ElementHelper::isDraftOrRevision($element)
                && !$element->propagating
                && !$element->resaving
                && $this->settings->etagCacheKey
                && $this->settings->etagTTL
            ) {
                Craft::$app->cache->redis->executeCommand('SET', [
                    $this->settings->etagCacheKey,
                    StringHelper::UUID(),
                    'EX',
                    $this->settings->etagTTL,
                ]);
            }
        });
    }
}
