

const mqtt = require('mqtt')

const client = mqtt.connect('mqtt://broker:1883')

client.on('connect', function() {
    console.log('connected')
})
