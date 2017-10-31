.PHONY: docker/build docker/push

docker/build:
	docker build . -t raptorbox/broker

docker/push: docker/build
	docker push raptorbox/broker:latest
