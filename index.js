
const config = require(process.env.CONFIG || './config.json')

const aedes = require('aedes')
const Raptor = require('raptor-sdk')
const logger = require('winston')

if(config.redis.persistence.ttl) {
    config.redis.persistence.packetTTL =  function (/*packet*/) {
        return config.redis.persistence.ttl
    }
}

const persistence = require('aedes-persistence-redis')(config.redis.persistence)
const mq = require('mqemitter-redis')(config.redis.mq)

const httpServer = require('http').createServer()
const ws = require('websocket-stream')

const api = new Raptor(config.raptor)

const getRaptor = () => {
    return api.Auth().login()
        .then(() => {
            return api.Admin().Token().list()
                .then((tokens) => {
                    if(tokens && tokens.getContent) {
                        tokens = tokens.getContent()
                    }
                    tokens = tokens ? tokens.filter((t) => t.name === config.token) : []
                    if(tokens.length) {
                        return Promise.resolve(tokens[0])
                    }
                    return api.Admin().Token().create({
                        name: config.token,
                        secret: config.token + Math.floor(Math.random*Date.now()),
                        expires: 0,
                        enabled: true
                    })
                })
                .then((t) => {
                    api.setConfig({
                        token: t.token,
                        url: api.getConfig().url
                    })
                    return api
                })
        })
}

const isLocalUser = (credentials) => {
    return (config.raptor.username === credentials.username
        && config.raptor.password === credentials.password)
}

const isAdmin = (u) => {
    return (u && u.roles)
        && (u.roles.indexOf('admin') > -1
            || u.roles.indexOf('service') > -1)
}

const hasPermission = ({r, type, permission, subjectId}) => {

    if(id === '+' || id === '#') {
        logger.warn('Invalid id [%s %s] %s', type, permission, id)
        return Promise.reject(new Error('Provided ID is not valid'))
    }

    return r.Admin().User().can({
        userId: r.Auth().getUser().id,
        type,
        subjectId,
        permission,
    }).then((res) => {
        return res.result ? Promise.resolve() : Promise.reject(new Error('Not authorized'))
    })
}

const checkTopic = (client, topic) => {

    if (!client.raptor) {
        return Promise.reject(new Error('Raptor instance not available'))
    }

    if(isLocalUser(client.raptor.getConfig()) ||
        isAdmin(client.raptor.Auth().getUser())
    ) {
        logger.debug('Local user topic allowed')
        return Promise.resolve()
    }

    return client.raptor.Auth().login().then(() => {

        logger.debug('Validating topic %s', topic)

        const parts = topic.split('/')
        let permission = 'read'
        const type = parts[0]
        const id = parts[1]
        if (!id) {
            return Promise.reject(new Error('Missing id in topic ' + topic ))
        }

        switch (type) {
        // case 'tree':
        // case 'device':
        // case 'token':
        // case 'user':
        // case 'role':
        case 'action':
            permission = 'execute'
            break
        case 'stream':
            permission = 'pull'
            break
        }

        return hasPermission({
            r: client.raptor,
            subjectId: id,
            type,
            permission,
        })
    })
}

const main = function() {

    logger.level = process.env.LOG_LEVEL || 'info'

    let broker = aedes({
        mq: mq,
        persistence: persistence,
        concurrency: 5000,
        heartbeatInterval: 60000,
        connectTimeout: 30000,
    })

    broker.authenticate = function (client, username, password, callback) {

        password = password ? password.toString() : null

        if((username == null || username.length === 0) || (password == null || password.length === 0)) {
            logger.debug('Empty username or password')
            return callback(null, false)
        }

        password = password.toString()
        logger.debug('authenticate: %s:%s', username, password)

        if (isLocalUser({username, password})) {
            logger.debug('Local user login')
            client.raptor = api
            return callback(null, true)
        }

        return getRaptor()
            .then((api) => {
                const url = config.raptor.url
                if (username.length <= 3) {
                    logger.debug('Token login')
                    const r = new Raptor({
                        url, token: password
                    })
                    return r.Auth().login()
                        .then(() => {
                            client.raptor = r
                            return Promise.resolve()
                        })
                } else {
                    logger.debug('Username and password login')
                    const r = new Raptor({
                        url, username,
                        password: password
                    })
                    return r.Auth().login()
                        .then(() => {
                            client.raptor = r
                            return Promise.resolve()
                        })
                }
            })
            .then(() => {
                logger.debug('Login ok')
                callback(null, true)
            })
            .catch((e) => {
                logger.warn('Login failed: %s', e.message)
                callback(e, false)
            })
    }

    broker.authorizePublish = function (client, packet, callback) {
        logger.debug('authorizePublish: %s', packet.topic)
        checkTopic(client, packet.topic)
            .then(() => {
                callback(null)
            })
            .catch((e) => {
                callback(e)
            })
    }

    broker.authorizeSubscribe = function (client, sub, callback) {
        logger.debug('authorizeSubscribe: %s', sub.topic)
        checkTopic(client, sub.topic)
            .then(() => {
                callback(null, sub)
            })
            .catch((e) => {
                callback(e)
            })
    }

    broker.authorizeForward = function (clientId, packet) {
        logger.debug('authorizeForward: %s', packet.topic)
        return packet
    }

    broker.published = function (packet, client, done) {
        logger.debug('published %s', packet.topic)
        done()
    }

    const server = require('net').createServer(broker.handle)
    server.listen(config.port, function () {
        logger.info('server listening on port %s', config.port)
    })

    ws.createServer({
        server: httpServer
    }, broker.handle)

    httpServer.listen(config.wsPort, function () {
        logger.info('websocket server listening on port %s', config.wsPort)
    })

    broker.on('clientError', function (client, err) {
        if (client) {
            logger.warn('client error: %s', err.message)
            // logger.debug('client [id:%s]', client.id)
            // logger.debug(err.stack)

        }
    })

    broker.on('publish', function (packet, client) {
        if (client) {
            logger.debug('message from client', client.id)
        }
    })

    broker.on('subscribe', function (subscriptions, client) {
        if (client) {
            logger.debug('subscribe from client', subscriptions, client.id)
        }
    })

    broker.on('client', function (client) {
        logger.debug('new client', client.id)
    })

}

main()
