<?php

namespace born05\craftcachecontrol\models;

use Craft;
use craft\base\Model;

/**
 * Cache control settings
 */
class Settings extends Model
{
    public string $etagCacheKey = 'cache-control-etag';
    public int $etagTTL = 60 * 60 * 24 * 365; // 1 year

    public function defineRules(): array
    {
        return [
            [['etagCacheKey', 'etagTTL'], 'required'],
            [['etagCacheKey'], 'string'],
            [['etagTTL'], 'integer', 'min' => 0],
        ];
    }
}
