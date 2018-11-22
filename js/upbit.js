'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, BadRequest, ExchangeNotAvailable, AuthenticationError, InvalidOrder, InsufficientFunds, OrderNotFound, DDoSProtection, PermissionDenied, AddressPending } = require ('./base/errors');
const { TRUNCATE, DECIMAL_PLACES } = require ('./base/functions/number');

//  ---------------------------------------------------------------------------

module.exports = class upbit extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'upbit',
            'name': 'UPbit',
            'countries': [ 'KR' ],
            'version': 'v1',
            'rateLimit': 1000,
            'certified': true,
            // new metainfo interface
            'has': {
                'CORS': true,
                'createMarketOrder': false,
                'fetchDepositAddress': true,
                'fetchClosedOrders': true,
                'fetchMyTrades': false,
                'fetchOHLCV': true,
                'fetchOrder': true,
                'fetchOpenOrders': true,
                'fetchTickers': true,
                'withdraw': true,
                'fetchDeposits': true,
                'fetchWithdrawals': true,
                'fetchTransactions': false,
            },
            'timeframes': {
                '1m': 'minutes',
                '3m': 'minutes',
                '5m': 'minutes',
                '15m': 'minutes',
                '30m': 'minutes',
                '1h': 'minutes',
                '4h': 'minutes',
                '1d': 'days',
                '1w': 'weeks',
                '1M': 'months',
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766352-cf0b3c26-5ed5-11e7-82b7-f3826b7a97d8.jpg',
                'api': 'https://api.upbit.com',
                'www': 'https://upbit.com',
                'doc': 'https://docs.upbit.com/docs/%EC%9A%94%EC%B2%AD-%EC%88%98-%EC%A0%9C%ED%95%9C',
                'fees': 'https://upbit.com/service_center/guide',
            },
            'api': {
                'public': {
                    'get': [
                        'market/all',
                        'candles/{timeframe}',
                        'candles/{timeframe}/{unit}',
                        'candles/minutes/{unit}',
                        'candles/minutes/1',
                        'candles/minutes/3',
                        'candles/minutes/5',
                        'candles/minutes/15',
                        'candles/minutes/30',
                        'candles/minutes/60',
                        'candles/minutes/240',
                        'candles/days',
                        'candles/weeks',
                        'candles/months',
                        'trades/ticks',
                        'ticker',
                        'orderbook',
                    ],
                },
                'private': {
                    'get': [
                        'accounts',
                        'orders/chance',
                        'order',
                        'orders',
                        'withdraws',
                        'withdraw',
                        'withdraws/chance',
                        'deposits',
                        'deposit',
                        'deposits/coin_addresses',
                        'deposits/coin_address',
                    ],
                    'post': [
                        'orders',
                        'withdraws/coin',
                        'withdraws/krw',
                        'deposits/generate_coin_address',
                    ],
                    'delete': [
                        'order',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'maker': 0.0025,
                    'taker': 0.0025,
                },
                'funding': {
                    'tierBased': false,
                    'percentage': false,
                    'withdraw': {},
                    'deposit': {},
                },
            },
            'exceptions': {
                'Missing request parameter error. Check the required parameters!': BadRequest, // 400 Bad Request {"error":{"name":400,"message":"Missing request parameter error. Check the required parameters!"}}
                // {"error":{"message":"side is missing, side does not have a valid value","name":"validation_error"}}
                // {"error":{"message":"개인정보 제 3자 제공 동의가 필요합니다.","name":"thirdparty_agreement_required"}}
                // {"error":{"message":"권한이 부족합니다.","name":"out_of_scope"}}
            },
            'options': {
                'fetchTickersMaxLength': 2048,
                'fetchOrderBooksMaxLength': 2048,
                // price precision by quote currency code
                'pricePrecisionByCode': {
                    'USD': 3,
                },
            },
            'commonCurrencies': {
            },
        });
    }

    async fetchTradingLimits (symbols = undefined, params = {}) {
        // this method should not be called directly, use loadTradingLimits () instead
        //  by default it will try load withdrawal fees of all currencies (with separate requests)
        //  however if you define symbols = [ 'ETH/BTC', 'LTC/BTC' ] in args it will only load those
        await this.loadMarkets ();
        if (symbols === undefined) {
            symbols = this.symbols;
        }
        let result = {};
        for (let i = 0; i < symbols.length; i++) {
            let symbol = symbols[i];
            result[symbol] = await this.fetchTradingLimitsById (this.marketId (symbol), params);
        }
        return result;
    }

    async fetchTradingLimitsById (id, params = {}) {
        let request = {
            'symbol': id,
        };
        let response = await this.publicGetCommonExchange (this.extend (request, params));
        //
        //     { status:   "ok",
        //         data: {                                  symbol: "aidocbtc",
        //                              'buy-limit-must-less-than':  1.1,
        //                          'sell-limit-must-greater-than':  0.9,
        //                         'limit-order-must-greater-than':  1,
        //                            'limit-order-must-less-than':  5000000,
        //                    'market-buy-order-must-greater-than':  0.0001,
        //                       'market-buy-order-must-less-than':  100,
        //                   'market-sell-order-must-greater-than':  1,
        //                      'market-sell-order-must-less-than':  500000,
        //                       'circuit-break-when-greater-than':  10000,
        //                          'circuit-break-when-less-than':  10,
        //                 'market-sell-order-rate-must-less-than':  0.1,
        //                  'market-buy-order-rate-must-less-than':  0.1        } }
        //
        return this.parseTradingLimits (this.safeValue (response, 'data', {}));
    }

    parseTradingLimits (limits, symbol = undefined, params = {}) {
        //
        //   {                                  symbol: "aidocbtc",
        //                  'buy-limit-must-less-than':  1.1,
        //              'sell-limit-must-greater-than':  0.9,
        //             'limit-order-must-greater-than':  1,
        //                'limit-order-must-less-than':  5000000,
        //        'market-buy-order-must-greater-than':  0.0001,
        //           'market-buy-order-must-less-than':  100,
        //       'market-sell-order-must-greater-than':  1,
        //          'market-sell-order-must-less-than':  500000,
        //           'circuit-break-when-greater-than':  10000,
        //              'circuit-break-when-less-than':  10,
        //     'market-sell-order-rate-must-less-than':  0.1,
        //      'market-buy-order-rate-must-less-than':  0.1        }
        //
        return {
            'info': limits,
            'limits': {
                'amount': {
                    'min': this.safeFloat (limits, 'limit-order-must-greater-than'),
                    'max': this.safeFloat (limits, 'limit-order-must-less-than'),
                },
            },
        };
    }

    async fetchMarkets () {
        const response = await this.publicGetMarketAll ();
        //
        //     [ {       market: "KRW-BTC",
        //          korean_name: "비트코인",
        //         english_name: "Bitcoin"  },
        //       {       market: "KRW-DASH",
        //          korean_name: "대시",
        //         english_name: "Dash"      },
        //       {       market: "KRW-ETH",
        //          korean_name: "이더리움",
        //         english_name: "Ethereum" },
        //       {       market: "BTC-ETH",
        //          korean_name: "이더리움",
        //         english_name: "Ethereum" },
        //       ...,
        //       {       market: "BTC-BSV",
        //          korean_name: "비트코인에스브이",
        //         english_name: "Bitcoin SV" } ]
        //
        const result = [];
        for (let i = 0; i < response.length; i++) {
            const market = response[i];
            const id = this.safeString (market, 'market');
            const [ quoteId, baseId ] = id.split ('-');
            const base = this.commonCurrencyCode (baseId);
            const quote = this.commonCurrencyCode (quoteId);
            const symbol = base + '/' + quote;
            const precision = {
                'amount': 8,
                'price': 8,
            };
            const active = true;
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': active,
                'info': market,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': Math.pow (10, -precision['amount']),
                        'max': undefined,
                    },
                    'price': {
                        'min': Math.pow (10, -precision['price']),
                        'max': undefined,
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                },
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetAccounts (params);
        //
        //     [ {          currency: "BTC",
        //                   balance: "0.005",
        //                    locked: "0.0",
        //         avg_krw_buy_price: "7446000",
        //                  modified:  false     },
        //       {          currency: "ETH",
        //                   balance: "0.1",
        //                    locked: "0.0",
        //         avg_krw_buy_price: "250000",
        //                  modified:  false    }   ]
        //
        let result = { 'info': response };
        let indexed = this.indexBy (response, 'currency');
        let ids = Object.keys (indexed);
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let currency = this.commonCurrencyCode (id);
            let account = this.account ();
            let balance = indexed[id];
            let total = this.safeFloat (balance, 'balance');
            let used = this.safeFloat (balance, 'locked');
            let free = total - used;
            account['free'] = free;
            account['used'] = used;
            account['total'] = total;
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    getSymbolFromMarketId (marketId, market = undefined) {
        if (marketId === undefined) {
            return undefined;
        }
        market = this.safeValue (this.markets_by_id, marketId, market);
        if (market !== undefined) {
            return market['symbol'];
        }
        const [ baseId, quoteId ] = marketId.split ('-');
        const base = this.commonCurrencyCode (baseId);
        const quote = this.commonCurrencyCode (quoteId);
        return base + '/' + quote;
    }

    async fetchOrderBooks (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let ids = undefined;
        if (symbols === undefined) {
            ids = this.ids.join (',');
            // max URL length is 2083 symbols, including http schema, hostname, tld, etc...
            if (ids.length > this.options['fetchOrderBooksMaxLength']) {
                let numIds = this.ids.length;
                throw new ExchangeError (this.id + ' has ' + numIds.toString () + ' symbols (' + ids.length.toString () + ' characters) exceeding max URL length (' + this.options['fetchOrderBooksMaxLength'].toString () + ' characters), you are required to specify a list of symbols in the first argument to fetchOrderBooks');
            }
        } else {
            ids = this.marketIds (symbols);
            ids = ids.join (',');
        }
        const request = {
            'markets': ids,
        };
        const response = await this.publicGetOrderbook (this.extend (request, params));
        //
        //     [ {          market:   "BTC-ETH",
        //               timestamp:    1542899030043,
        //          total_ask_size:    109.57065201,
        //          total_bid_size:    125.74430631,
        //         orderbook_units: [ { ask_price: 0.02926679,
        //                              bid_price: 0.02919904,
        //                               ask_size: 4.20293961,
        //                               bid_size: 11.65043576 },
        //                            ...,
        //                            { ask_price: 0.02938209,
        //                              bid_price: 0.0291231,
        //                               ask_size: 0.05135782,
        //                               bid_size: 13.5595     }   ] },
        //       {          market:   "KRW-BTC",
        //               timestamp:    1542899034662,
        //          total_ask_size:    12.89790974,
        //          total_bid_size:    4.88395783,
        //         orderbook_units: [ { ask_price: 5164000,
        //                              bid_price: 5162000,
        //                               ask_size: 2.57606495,
        //                               bid_size: 0.214       },
        //                            ...,
        //                            { ask_price: 5176000,
        //                              bid_price: 5152000,
        //                               ask_size: 2.752,
        //                               bid_size: 0.4650305 }    ] }   ]
        //
        let result = {};
        for (let i = 0; i < response.length; i++) {
            const orderbook = response[i];
            const symbol = this.getSymbolFromMarketId (this.safeString (orderbook, 'market'));
            const timestamp = this.safeInteger (orderbook, 'timestamp');
            result[symbol] = {
                'bids': this.parseBidsAsks (orderbook['orderbook_units'], 'bid_price', 'bid_size'),
                'asks': this.parseBidsAsks (orderbook['orderbook_units'], 'ask_price', 'bid_size'),
                'timestamp': timestamp,
                'datetime': this.iso8601 (timestamp),
                'nonce': undefined,
            };
        }
        return result;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        let orderbooks = await this.fetchOrderBooks ([ symbol ], params);
        return this.safeValue (orderbooks, symbol);
    }

    parseTicker (ticker, market = undefined) {
        //
        //       {                market: "BTC-ETH",
        //                    trade_date: "20181122",
        //                    trade_time: "104543",
        //                trade_date_kst: "20181122",
        //                trade_time_kst: "194543",
        //               trade_timestamp:  1542883543097,
        //                 opening_price:  0.02976455,
        //                    high_price:  0.02992577,
        //                     low_price:  0.02934283,
        //                   trade_price:  0.02947773,
        //            prev_closing_price:  0.02966,
        //                        change: "FALL",
        //                  change_price:  0.00018227,
        //                   change_rate:  0.0061453136,
        //           signed_change_price:  -0.00018227,
        //            signed_change_rate:  -0.0061453136,
        //                  trade_volume:  1.00000005,
        //               acc_trade_price:  100.95825586,
        //           acc_trade_price_24h:  289.58650166,
        //              acc_trade_volume:  3409.85311036,
        //          acc_trade_volume_24h:  9754.40510513,
        //         highest_52_week_price:  0.12345678,
        //          highest_52_week_date: "2018-02-01",
        //          lowest_52_week_price:  0.023936,
        //           lowest_52_week_date: "2017-12-08",
        //                     timestamp:  1542883543813  }
        //
        let timestamp = this.safeInteger (ticker, 'trade_timestamp');
        let symbol = this.getSymbolFromMarketId (this.safeString (ticker, 'market'), market);
        let previous = this.safeFloat (ticker, 'prev_closing_price');
        let last = this.safeFloat (ticker, 'trade_price');
        let change = this.safeFloat (ticker, 'signed_change_price');
        let percentage = this.safeFloat (ticker, 'signed_change_rate');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'high_price'),
            'low': this.safeFloat (ticker, 'low_price'),
            'bid': undefined,
            'bidVolume': undefined,
            'ask': undefined,
            'askVolume': undefined,
            'vwap': undefined,
            'open': this.safeFloat (ticker, 'opening_price'),
            'close': last,
            'last': last,
            'previousClose': previous,
            'change': change,
            'percentage': percentage,
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'acc_trade_price_24h'),
            'quoteVolume': this.safeFloat (ticker, 'acc_trade_volume_24h'),
            'info': ticker,
        };
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let ids = undefined;
        if (symbols === undefined) {
            ids = this.ids.join (',');
            // max URL length is 2083 symbols, including http schema, hostname, tld, etc...
            if (ids.length > this.options['fetchTickersMaxLength']) {
                let numIds = this.ids.length;
                throw new ExchangeError (this.id + ' has ' + numIds.toString () + ' symbols exceeding max URL length, you are required to specify a list of symbols in the first argument to fetchTickers');
            }
        } else {
            ids = this.marketIds (symbols);
            ids = ids.join (',');
        }
        const request = {
            'markets': ids,
        };
        let response = await this.publicGetTicker (this.extend (request, params));
        //
        //     [ {                market: "BTC-ETH",
        //                    trade_date: "20181122",
        //                    trade_time: "104543",
        //                trade_date_kst: "20181122",
        //                trade_time_kst: "194543",
        //               trade_timestamp:  1542883543097,
        //                 opening_price:  0.02976455,
        //                    high_price:  0.02992577,
        //                     low_price:  0.02934283,
        //                   trade_price:  0.02947773,
        //            prev_closing_price:  0.02966,
        //                        change: "FALL",
        //                  change_price:  0.00018227,
        //                   change_rate:  0.0061453136,
        //           signed_change_price:  -0.00018227,
        //            signed_change_rate:  -0.0061453136,
        //                  trade_volume:  1.00000005,
        //               acc_trade_price:  100.95825586,
        //           acc_trade_price_24h:  289.58650166,
        //              acc_trade_volume:  3409.85311036,
        //          acc_trade_volume_24h:  9754.40510513,
        //         highest_52_week_price:  0.12345678,
        //          highest_52_week_date: "2018-02-01",
        //          lowest_52_week_price:  0.023936,
        //           lowest_52_week_date: "2017-12-08",
        //                     timestamp:  1542883543813  } ]
        //
        let result = {};
        for (let t = 0; t < response.length; t++) {
            let ticker = this.parseTicker (response[t]);
            let symbol = ticker['symbol'];
            result[symbol] = ticker;
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        const tickers = await this.fetchTickers ([ symbol ], params);
        return this.safeValue (tickers, symbol);
    }

    parseTrade (trade, market = undefined) {
        //
        //       {             market: "BTC-ETH",
        //             trade_date_utc: "2018-11-22",
        //             trade_time_utc: "13:55:24",
        //                  timestamp:  1542894924397,
        //                trade_price:  0.02914289,
        //               trade_volume:  0.20074397,
        //         prev_closing_price:  0.02966,
        //               change_price:  -0.00051711,
        //                    ask_bid: "ASK",
        //              sequential_id:  15428949259430000 },
        //
        let timestamp = this.safeInteger (trade, 'timestamp');
        let side = undefined;
        let askOrBid = this.safeString (trade, 'ask_bid');
        if (askOrBid === 'ASK') {
            side = 'sell';
        } else if (askOrBid === 'BID') {
            side = 'buy';
        }
        let id = this.safeString (trade, 'sequential_id');
        let symbol = this.getSymbolFromMarketId (this.safeString (trade, 'market'), market);
        let cost = undefined;
        let price = this.safeFloat (trade, 'trade_price');
        let amount = this.safeFloat (trade, 'trade_volume');
        if (amount !== undefined) {
            if (price !== undefined) {
                cost = price * amount;
            }
        }
        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': 'limit',
            'side': side,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': undefined,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        if (limit === undefined) {
            limit = 200;
        }
        const request = {
            'market': market['id'],
            'count': limit,
        };
        let response = await this.publicGetTradesTicks (this.extend (request, params));
        //
        //     [ {             market: "BTC-ETH",
        //             trade_date_utc: "2018-11-22",
        //             trade_time_utc: "13:55:24",
        //                  timestamp:  1542894924397,
        //                trade_price:  0.02914289,
        //               trade_volume:  0.20074397,
        //         prev_closing_price:  0.02966,
        //               change_price:  -0.00051711,
        //                    ask_bid: "ASK",
        //              sequential_id:  15428949259430000 },
        //       {             market: "BTC-ETH",
        //             trade_date_utc: "2018-11-22",
        //             trade_time_utc: "13:03:10",
        //                  timestamp:  1542891790123,
        //                trade_price:  0.02917,
        //               trade_volume:  7.392,
        //         prev_closing_price:  0.02966,
        //               change_price:  -0.00049,
        //                    ask_bid: "ASK",
        //              sequential_id:  15428917910540000 }  ]
        //
        return this.parseTrades (response, market, since, limit);
    }

    parseOHLCV (ohlcv, market = undefined, timeframe = '1d', since = undefined, limit = undefined) {
        //
        //       {                  market: "BTC-ETH",
        //            candle_date_time_utc: "2018-11-22T13:47:00",
        //            candle_date_time_kst: "2018-11-22T22:47:00",
        //                   opening_price:  0.02915963,
        //                      high_price:  0.02915963,
        //                       low_price:  0.02915448,
        //                     trade_price:  0.02915448,
        //                       timestamp:  1542894473674,
        //          candle_acc_trade_price:  0.0981629437535248,
        //         candle_acc_trade_volume:  3.36693173,
        //                            unit:  1                     },
        //
        return [
            this.safeInteger (ohlcv, 'timestamp'),
            this.safeFloat (ohlcv, 'opening_price'),
            this.safeFloat (ohlcv, 'high_price'),
            this.safeFloat (ohlcv, 'low_price'),
            this.safeFloat (ohlcv, 'trade_price'),
            this.safeFloat (ohlcv, 'candle_acc_trade_price'), // base volume
        ];
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let timeframePeriod = this.parseTimeframe (timeframe);
        let timeframeValue = this.timeframes[timeframe];
        if (limit === undefined) {
            limit = 200;
        }
        let request = {
            'market': market['id'],
            'timeframe': timeframeValue,
            'count': limit,
        };
        let method = 'publicGetCandlesTimeframe';
        if (timeframeValue === 'minutes') {
            let numMinutes = Math.round (timeframePeriod / 60);
            request['unit'] = numMinutes;
            method += 'Unit';
        }
        let response = await this[method] (this.extend (request, params));
        //
        //     [ {                  market: "BTC-ETH",
        //            candle_date_time_utc: "2018-11-22T13:47:00",
        //            candle_date_time_kst: "2018-11-22T22:47:00",
        //                   opening_price:  0.02915963,
        //                      high_price:  0.02915963,
        //                       low_price:  0.02915448,
        //                     trade_price:  0.02915448,
        //                       timestamp:  1542894473674,
        //          candle_acc_trade_price:  0.0981629437535248,
        //         candle_acc_trade_volume:  3.36693173,
        //                            unit:  1                     },
        //       {                  market: "BTC-ETH",
        //            candle_date_time_utc: "2018-11-22T10:06:00",
        //            candle_date_time_kst: "2018-11-22T19:06:00",
        //                   opening_price:  0.0294,
        //                      high_price:  0.02940882,
        //                       low_price:  0.02934283,
        //                     trade_price:  0.02937354,
        //                       timestamp:  1542881219276,
        //          candle_acc_trade_price:  0.0762597110943884,
        //         candle_acc_trade_volume:  2.5949617,
        //                            unit:  1                     }  ]
        //
        return this.parseOHLCVs (response, market, timeframe, since, limit);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        if (type !== 'limit') {
            throw new InvalidOrder (this.id + ' createOrder allows limit orders only!');
        }
        let orderSide = undefined;
        if (side === 'buy') {
            orderSide = 'bid';
        } else if (side === 'sell') {
            orderSide = 'ask';
        } else {
            throw new InvalidOrder (this.id + ' createOrder allows buy or sell side only!');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market': market['id'],
            'side': orderSide,
            'volume': this.amountToPrecision (symbol, amount),
            'price': this.priceToPrecision (symbol, price),
            'ord_type': type,
        };
        const response = await this.privatePostOrders (this.extend (request, params));
        const log = require ('ololog').unlimited;
        log.green (response);
        process.exit ();
        //
        //     {
        //         'uuid': 'cdd92199-2897-4e14-9448-f923320408ad',
        //         'side': 'bid',
        //         'ord_type': 'limit',
        //         'price': '100.0',
        //         'avg_price': '0.0',
        //         'state': 'wait',
        //         'market': 'KRW-BTC',
        //         'created_at': '2018-04-10T15:42:23+09:00',
        //         'volume': '0.01',
        //         'remaining_volume': '0.01',
        //         'reserved_fee': '0.0015',
        //         'remaining_fee': '0.0015',
        //         'paid_fee': '0.0',
        //         'locked': '1.0015',
        //         'executed_volume': '0.0',
        //         'trades_count': 0
        //     }
        //
        return this.parseOrder (response);
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {
            'uuid': id,
        };
        let response = await this.privateDeleteOrder (this.extend (request, params));
        //
        //     {
        //         "uuid": "cdd92199-2897-4e14-9448-f923320408ad",
        //         "side": "bid",
        //         "ord_type": "limit",
        //         "price": "100.0",
        //         "state": "wait",
        //         "market": "KRW-BTC",
        //         "created_at": "2018-04-10T15:42:23+09:00",
        //         "volume": "0.01",
        //         "remaining_volume": "0.01",
        //         "reserved_fee": "0.0015",
        //         "remaining_fee": "0.0015",
        //         "paid_fee": "0.0",
        //         "locked": "1.0015",
        //         "executed_volume": "0.0",
        //         "trades_count": 0
        //     }
        //
        return this.parseOrder (response);
    }

    async fetchDeposits (code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        // https://support.bittrex.com/hc/en-us/articles/115003723911
        const request = {};
        let currency = undefined;
        if (code !== undefined) {
            currency = this.currency (code);
            request['currency'] = currency['id'];
        }
        const response = await this.accountGetDeposithistory (this.extend (request, params));
        //
        //     { success:    true,
        //       message:   "",
        //        result: [ {            Id:  22578097,
        //                           Amount:  0.3,
        //                         Currency: "ETH",
        //                    Confirmations:  15,
        //                      LastUpdated: "2018-06-10T07:12:10.57",
        //                             TxId: "0xf50b5ba2ca5438b58f93516eaa523eaf35b4420ca0f24061003df1be7…",
        //                    CryptoAddress: "0xb25f281fa51f1635abd4a60b0870a62d2a7fa404"                    } ] }
        //
        // we cannot filter by `since` timestamp, as it isn't set by Bittrex
        // see https://github.com/ccxt/ccxt/issues/4067
        // return this.parseTransactions (response['result'], currency, since, limit);
        return this.parseTransactions (response['result'], currency, undefined, limit);
    }

    async fetchWithdrawals (code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        // https://support.bittrex.com/hc/en-us/articles/115003723911
        const request = {};
        let currency = undefined;
        if (code !== undefined) {
            currency = this.currency (code);
            request['currency'] = currency['id'];
        }
        const response = await this.accountGetWithdrawalhistory (this.extend (request, params));
        //
        //     {
        //         "success" : true,
        //         "message" : "",
        //         "result" : [{
        //                 "PaymentUuid" : "b32c7a5c-90c6-4c6e-835c-e16df12708b1",
        //                 "Currency" : "BTC",
        //                 "Amount" : 17.00000000,
        //                 "Address" : "1DfaaFBdbB5nrHj87x3NHS4onvw1GPNyAu",
        //                 "Opened" : "2014-07-09T04:24:47.217",
        //                 "Authorized" : true,
        //                 "PendingPayment" : false,
        //                 "TxCost" : 0.00020000,
        //                 "TxId" : null,
        //                 "Canceled" : true,
        //                 "InvalidAddress" : false
        //             }, {
        //                 "PaymentUuid" : "d193da98-788c-4188-a8f9-8ec2c33fdfcf",
        //                 "Currency" : "XC",
        //                 "Amount" : 7513.75121715,
        //                 "Address" : "TcnSMgAd7EonF2Dgc4c9K14L12RBaW5S5J",
        //                 "Opened" : "2014-07-08T23:13:31.83",
        //                 "Authorized" : true,
        //                 "PendingPayment" : false,
        //                 "TxCost" : 0.00002000,
        //                 "TxId" : "d8a575c2a71c7e56d02ab8e26bb1ef0a2f6cf2094f6ca2116476a569c1e84f6e",
        //                 "Canceled" : false,
        //                 "InvalidAddress" : false
        //             }
        //         ]
        //     }
        //
        return this.parseTransactions (response['result'], currency, since, limit);
    }

    parseTransaction (transaction, currency = undefined) {
        //
        // fetchDeposits
        //
        //      {            Id:  72578097,
        //               Amount:  0.3,
        //             Currency: "ETH",
        //        Confirmations:  15,
        //          LastUpdated: "2018-06-17T07:12:14.57",
        //                 TxId: "0xb31b5ba2ca5438b58f93516eaa523eaf35b4420ca0f24061003df1be7…",
        //        CryptoAddress: "0x2d5f281fa51f1635abd4a60b0870a62d2a7fa404"                    }
        //
        // fetchWithdrawals
        //
        //     {
        //         "PaymentUuid" : "e293da98-788c-4188-a8f9-8ec2c33fdfcf",
        //         "Currency" : "XC",
        //         "Amount" : 7513.75121715,
        //         "Address" : "EVnSMgAd7EonF2Dgc4c9K14L12RBaW5S5J",
        //         "Opened" : "2014-07-08T23:13:31.83",
        //         "Authorized" : true,
        //         "PendingPayment" : false,
        //         "TxCost" : 0.00002000,
        //         "TxId" : "b4a575c2a71c7e56d02ab8e26bb1ef0a2f6cf2094f6ca2116476a569c1e84f6e",
        //         "Canceled" : false,
        //         "InvalidAddress" : false
        //     }
        //
        const id = this.safeString2 (transaction, 'Id', 'PaymentUuid');
        const amount = this.safeFloat (transaction, 'Amount');
        const address = this.safeString2 (transaction, 'CryptoAddress', 'Address');
        const txid = this.safeString (transaction, 'TxId');
        const updated = this.parse8601 (this.safeValue (transaction, 'LastUpdated'));
        const timestamp = this.parse8601 (this.safeString (transaction, 'Opened', updated));
        const type = (timestamp !== undefined) ? 'withdrawal' : 'deposit';
        let code = undefined;
        let currencyId = this.safeString (transaction, 'Currency');
        currency = this.safeValue (this.currencies_by_id, currencyId);
        if (currency !== undefined) {
            code = currency['code'];
        } else {
            code = this.commonCurrencyCode (currencyId);
        }
        let status = 'pending';
        if (type === 'deposit') {
            if (currency !== undefined) {
                // deposits numConfirmations never reach the minConfirmations number
                // we set all of them to 'ok', otherwise they'd all be 'pending'
                //
                //     const numConfirmations = this.safeInteger (transaction, 'Confirmations', 0);
                //     const minConfirmations = this.safeInteger (currency['info'], 'MinConfirmation');
                //     if (numConfirmations >= minConfirmations) {
                //         status = 'ok';
                //     }
                //
                status = 'ok';
            }
        } else {
            const authorized = this.safeValue (transaction, 'Authorized', false);
            const pendingPayment = this.safeValue (transaction, 'PendingPayment', false);
            const canceled = this.safeValue (transaction, 'Canceled', false);
            const invalidAddress = this.safeValue (transaction, 'InvalidAddress', false);
            if (invalidAddress) {
                status = 'failed';
            } else if (canceled) {
                status = 'canceled';
            } else if (pendingPayment) {
                status = 'pending';
            } else if (authorized && (txid !== undefined)) {
                status = 'ok';
            }
        }
        let feeCost = this.safeFloat (transaction, 'TxCost');
        if (feeCost === undefined) {
            if (type === 'deposit') {
                // according to https://support.bittrex.com/hc/en-us/articles/115000199651-What-fees-does-Bittrex-charge-
                feeCost = 0; // FIXME: remove hardcoded value that may change any time
            } else if (type === 'withdrawal') {
                throw new ExchangeError ('Withdrawal without fee detected!');
            }
        }
        return {
            'info': transaction,
            'id': id,
            'currency': code,
            'amount': amount,
            'address': address,
            'tag': undefined,
            'status': status,
            'type': type,
            'updated': updated,
            'txid': txid,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'fee': {
                'currency': code,
                'cost': feeCost,
            },
        };
    }

    parseSymbol (id) {
        let [ quote, base ] = id.split (this.options['symbolSeparator']);
        base = this.commonCurrencyCode (base);
        quote = this.commonCurrencyCode (quote);
        return base + '/' + quote;
    }

    parseOrder (order, market = undefined) {
        //
        //     {
        //         "uuid": "a08f09b1-1718-42e2-9358-f0e5e083d3ee",
        //         "side": "bid",
        //         "ord_type": "limit",
        //         "price": "17417000.0",
        //         "state": "done",
        //         "market": "KRW-BTC",
        //         "created_at": "2018-04-05T14:09:14+09:00",
        //         "volume": "1.0",
        //         "remaining_volume": "0.0",
        //         "reserved_fee": "26125.5",
        //         "remaining_fee": "25974.0",
        //         "paid_fee": "151.5",
        //         "locked": "17341974.0",
        //         "executed_volume": "1.0",
        //         "trades_count": 2,
        //         "trades": [
        //             {
        //                 "market": "KRW-BTC",
        //                 "uuid": "78162304-1a4d-4524-b9e6-c9a9e14d76c3",
        //                 "price": "101000.0",
        //                 "volume": "0.77368323",
        //                 "funds": "78142.00623",
        //                 "ask_fee": "117.213009345",
        //                 "bid_fee": "117.213009345",
        //                 "created_at": "2018-04-05T14:09:15+09:00",
        //                 "side": "bid",
        //             },
        //             {
        //                 "market": "KRW-BTC",
        //                 "uuid": "f73da467-c42f-407d-92fa-e10d86450a20",
        //                 "price": "101000.0",
        //                 "volume": "0.22631677",
        //                 "funds": "22857.99377",
        //                 "ask_fee": "34.286990655",
        //                 "bid_fee": "34.286990655",
        //                 "created_at": "2018-04-05T14:09:15+09:00",
        //                 "side": "bid",
        //             },
        //         ],
        //     }
        //
        let id = this.safeString (order, 'uuid');
        let side = this.safeString (order, 'side');
        if (side === 'bid') {
            side = 'buy';
        } else {
            side = 'sell';
        }
        let type = this.safeString (order, 'ord_type');
        let timestamp = this.parse8601 (this.safeString (order, 'created_at'));
        let status = this.parseOrderStatus (this.safeString (order, 'state'));
        let symbol = this.getSymbolFromMarketId (this.safeString (order, 'market'), market);
        let lastTradeTimestamp = undefined;
        let fee = undefined;
        if (commission) {
            fee = {
                'cost': parseFloat (order[commission]),
            };
            if (market !== undefined) {
                fee['currency'] = market['quote'];
            } else if (symbol !== undefined) {
                let currencyIds = symbol.split ('/');
                let quoteCurrencyId = currencyIds[1];
                if (quoteCurrencyId in this.currencies_by_id)
                    fee['currency'] = this.currencies_by_id[quoteCurrencyId]['code'];
                else
                    fee['currency'] = this.commonCurrencyCode (quoteCurrencyId);
            }
        }
        let price = this.safeFloat (order, 'price');
        let amount = this.safeFloat (order, 'volume');
        let remaining = this.safeFloat (order, 'remaining_volume');
        let filled = this.safeFloat (order, 'executed_volume');
        let cost = undefined;
        let average = undefined;
        if (cost === undefined) {
            if ((price !== undefined) && (filled !== undefined)) {
                cost = price * filled;
            }
        }
        let result = {
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'cost': cost,
            'average': average,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
        };
        return result;
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {
            'market': this.marketId (symbol),
            'state': 'wait',
            'page': 1,
            'order_by': 'asc',
        };
        const response = await this.privateGetOrders (this.extend (request, params));
        const log = require ('ololog').unlimited;
        log.green (response);
        process.exit ();
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {
            'uuid': id,
        };
        let response = await this.publicGetmarketGetCancel (this.extend (request, params));
        //
        //     {
        //         "uuid": "a08f09b1-1718-42e2-9358-f0e5e083d3ee",
        //         "side": "bid",
        //         "ord_type": "limit",
        //         "price": "17417000.0",
        //         "state": "done",
        //         "market": "KRW-BTC",
        //         "created_at": "2018-04-05T14:09:14+09:00",
        //         "volume": "1.0",
        //         "remaining_volume": "0.0",
        //         "reserved_fee": "26125.5",
        //         "remaining_fee": "25974.0",
        //         "paid_fee": "151.5",
        //         "locked": "17341974.0",
        //         "executed_volume": "1.0",
        //         "trades_count": 2,
        //         "trades": [
        //             {
        //                 "market": "KRW-BTC",
        //                 "uuid": "78162304-1a4d-4524-b9e6-c9a9e14d76c3",
        //                 "price": "101000.0",
        //                 "volume": "0.77368323",
        //                 "funds": "78142.00623",
        //                 "ask_fee": "117.213009345",
        //                 "bid_fee": "117.213009345",
        //                 "created_at": "2018-04-05T14:09:15+09:00",
        //                 "side": "bid"
        //             },
        //             {
        //                 "market": "KRW-BTC",
        //                 "uuid": "f73da467-c42f-407d-92fa-e10d86450a20",
        //                 "price": "101000.0",
        //                 "volume": "0.22631677",
        //                 "funds": "22857.99377",
        //                 "ask_fee": "34.286990655",
        //                 "bid_fee": "34.286990655",
        //                 "created_at": "2018-04-05T14:09:15+09:00",
        //                 "side": "bid"
        //             }
        //         ]
        //     }
        //
        return this.parseOrder (response);
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {};
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
            request['market'] = market['id'];
        }
        let response = await this.accountGetOrderhistory (this.extend (request, params));
        let orders = this.parseOrders (response['result'], market, since, limit);
        if (symbol !== undefined)
            return this.filterBySymbol (orders, symbol);
        return orders;
    }

    async fetchDepositAddress (code, params = {}) {
        await this.loadMarkets ();
        let currency = this.currency (code);
        let response = await this.accountGetDepositaddress (this.extend ({
            'currency': currency['id'],
        }, params));
        let address = this.safeString (response['result'], 'Address');
        let message = this.safeString (response, 'message');
        if (!address || message === 'ADDRESS_GENERATING')
            throw new AddressPending (this.id + ' the address for ' + code + ' is being generated (pending, not ready yet, retry again later)');
        let tag = undefined;
        if ((code === 'XRP') || (code === 'XLM') || (code === 'LSK')) {
            tag = address;
            address = currency['address'];
        }
        this.checkAddress (address);
        return {
            'currency': code,
            'address': address,
            'tag': tag,
            'info': response,
        };
    }

    async withdraw (code, amount, address, tag = undefined, params = {}) {
        this.checkAddress (address);
        await this.loadMarkets ();
        let currency = this.currency (code);
        let request = {
            'currency': currency['id'],
            'quantity': amount,
            'address': address,
        };
        if (tag)
            request['paymentid'] = tag;
        let response = await this.accountGetWithdraw (this.extend (request, params));
        let id = undefined;
        if ('result' in response) {
            if ('uuid' in response['result'])
                id = response['result']['uuid'];
        }
        return {
            'info': response,
            'id': id,
        };
    }

    nonce () {
        return this.milliseconds ();
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + this.version + '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (api === 'public') {
            if (Object.keys (query).length)
                url += '?' + this.urlencode (query);
        } else {
            this.checkRequiredCredentials ();
            const nonce = this.nonce ();
            const request = {
                'access_key': this.apiKey,
                'nonce': nonce,
            };
            if ((method === 'POST') || (method === 'DELETE')) {
                request['query'] = this.urlencode (params);
            }
            let jwt = this.jwt (request, this.secret);
            headers = {
                'Authorization': 'Bearer ' + jwt,
            };
            if (method === 'POST') {
                body = this.json (params);
                headers['Content-Type'] = 'application/json';
            }
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (httpCode, reason, url, method, headers, body) {
        if (!this.isJsonEncodedObject (body))
            return; // fallback to default error handler
        let response = JSON.parse (body);
        if ('success' in response) {
            //
            // 1 - Liqui only returns the integer 'success' key from their private API
            //
            //     { "success": 1, ... } httpCode === 200
            //     { "success": 0, ... } httpCode === 200
            //
            // 2 - However, exchanges derived from Liqui, can return non-integers
            //
            //     It can be a numeric string
            //     { "sucesss": "1", ... }
            //     { "sucesss": "0", ... }, httpCode >= 200 (can be 403, 502, etc)
            //
            //     Or just a string
            //     { "success": "true", ... }
            //     { "success": "false", ... }, httpCode >= 200
            //
            //     Or a boolean
            //     { "success": true, ... }
            //     { "success": false, ... }, httpCode >= 200
            //
            // 3 - Oversimplified, Python PEP8 forbids comparison operator (===) of different types
            //
            // 4 - We do not want to copy-paste and duplicate the code of this handler to other exchanges derived from Liqui
            //
            // To cover points 1, 2, 3 and 4 combined this handler should work like this:
            //
            let success = this.safeValue (response, 'success', false);
            if (typeof success === 'string') {
                if ((success === 'true') || (success === '1'))
                    success = true;
                else
                    success = false;
            }
            if (!success) {
                const code = this.safeString (response, 'code');
                const message = this.safeString (response, 'error');
                const feedback = this.id + ' ' + this.json (response);
                const exact = this.exceptions['exact'];
                if (code in exact) {
                    throw new exact[code] (feedback);
                }
                const broad = this.exceptions['broad'];
                const broadKey = this.findBroadlyMatchedKey (broad, message);
                if (broadKey !== undefined) {
                    throw new broad[broadKey] (feedback);
                }
                throw new ExchangeError (feedback); // unknown message
            }
        }
    }
};
