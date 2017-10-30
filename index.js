
const config = require(process.env.CONFIG || './config.json')

const aedes = require('aedes')
const mongodb = require('mqemitter-mongodb')
const Raptor = require('raptor-sdk')
const logger = require('winston')

const persistence = require('aedes-persistence-mongodb')(config.mongodb.persistence)
const mq = mongodb(config.mongodb.mq)
const httpServer = require('http').createServer()
const ws = require('websocket-stream')

var port = 1883
var wsPort = 8888

const api = new Raptor(config.raptor)

const getRaptor = () => {
    return api.Auth().login()
        .then(() => {
            return api
        })
}

const isAdmin = (u) => {
    return (u && u.roles)
        && (u.roles.indexOf('admin') > -1
            || u.roles.indexOf('super_admin') > -1)
}

const hasDevicePermission = (r, id, permission) => {

    if(id === null || id === '+' || id === '#') {
        return Promise.reject(new Error('Provided ID is not valid'))
    }

    return r.Admin().User().isAuthorized(id, r.Auth().getUser().uuid, permission)
        .then((res) => {
            return res.result ? Promise.resolve() : Promise.reject(new Error('Not authorized'))
        })
}

const checkTopic = (client, topic) => {

    if (!client.raptor) {
        return Promise.reject(new Error('Raptor instance not available'))
    }

    return client.raptor.Auth().login().then(() => {

        if(client.raptor.Auth().getUser().username === config.raptor.username &&
            isAdmin(client.raptor.Auth().getUser())
        ) {
            return Promise.resolve()
        }

        logger.info('Validating topic %s', topic)

        const parts = topic.split('/')

        const id = parts[1]
        if (!id) {
            return Promise.reject(new Error('Missing id in topic ' + topic ))
        }

        switch (parts[0]) {
        case 'tree':
            return hasDevicePermission(client.raptor, id, 'tree')
        case 'device':
            return hasDevicePermission(client.raptor, id, 'admin')
        case 'action':
            return hasDevicePermission(client.raptor, id, 'execute')
        case 'stream':
            return hasDevicePermission(client.raptor, id, 'pull')
        case 'token':
        case 'user':
            return isAdmin(client.raptor.Auth().getUser()) ?
                Promise.resolve() : Promise.reject(new Error('Not an admin'))
        }

        return Promise.reject(new Error('Topic unknown: ' + parts[0]))
    })
}

const main = function() {

    let broker = aedes({
        mq: mq,
        persistence: persistence,
        concurrency: 100,
        heartbeatInterval: 60000,
        connectTimeout: 30000,
    })

    broker.authenticate = function (client, username, password, callback) {

        logger.info('authenticate: %s:%s', username, password)

        if((username == null || username.length === 0) || (password == null || password.length === 0)) {
            logger.info('Empty username or password')
            return callback(null, false)
        }

        if (config.raptor.username === username
            && config.raptor.password === password ) {
            client.raptor = api
            return Promise.resolve()
        }

        return getRaptor()
            .then((api) => {
                const url = config.raptor.url
                if (username.length <= 3) {
                    logger.info('Token login')
                    const r = new Raptor({
                        url, token: password.toString()
                    })
                    return r.Auth().login()
                        .then(() => {
                            client.raptor = r
                            return Promise.resolve()
                        })
                } else {
                    logger.info('Username and password login')
                    const r = new Raptor({
                        url, username,
                        password: password.toString()
                    })
                    return r.Auth().login()
                        .then(() => {
                            client.raptor = r
                            return Promise.resolve()
                        })
                }
            })
            .then(() => {
                logger.info('Login ok')
                callback(null, true)
            })
            .catch((e) => {
                logger.info('Login failed: %s', e.message)
                callback(e, false)
            })
    }

    broker.authorizePublish = function (client, packet, callback) {
        logger.info('authorizePublish: %s', packet.topic)
        checkTopic(client, packet.topic)
            .then(() => {
                callback(null)
            })
            .catch((e) => {
                callback(e)
            })
    }

    broker.authorizeSubscribe = function (client, sub, callback) {
        logger.info('authorizeSubscribe: %s', sub.topic)
        checkTopic(client, sub.topic)
            .then(() => {
                callback(null, sub)
            })
            .catch((e) => {
                callback(e)
            })
    }

    broker.authorizeForward = function (clientId, packet) {
        logger.info('authorizeForward: %s', packet.topic)
        return packet
    }

    broker.published = function (packet, client, done) {
        logger.info('published %s', packet.topic)
        done()
    }

    const server = require('net').createServer(broker.handle)
    server.listen(port, function () {
        logger.info('server listening on port %s', port)
    })

    ws.createServer({
        server: httpServer
    }, broker.handle)

    httpServer.listen(wsPort, function () {
        logger.info('websocket server listening on port %s', wsPort)
    })

    broker.on('clientError', function (client, err) {
        logger.info('client error', client.id, err.message, err.stack)
    })

    broker.on('publish', function (packet, client) {
        if (client) {
            logger.info('message from client', client.id)
        }
    })

    broker.on('subscribe', function (subscriptions, client) {
        if (client) {
            logger.info('subscribe from client', subscriptions, client.id)
        }
    })

    broker.on('client', function (client) {
        logger.info('new client', client.id)
    })

}

main()