const { defineFunction } = require('@aws-amplify/backend')

const handler = defineFunction({
	name: 'custom-authorizer-fn',
	resourceGroupName: 'auth'
})

module.exports = { handler }