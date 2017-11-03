
const mqtt = require('mqtt')

const client = mqtt.connect(process.env.URL, {
    username: process.env.USERNAME,
    password: process.env.PASSWORD
})

client.on('connect', function() {
    console.log('connected')
})
client.on('error', function(err) {
    console.log('err', err)
})
