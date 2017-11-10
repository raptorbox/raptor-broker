.PHONY: docker/build docker/push

name := raptorbox/broker

gittag := $(shell git describe --tag)
tag := $(shell echo ${gittag} | cut -d'-' -f 1)
basetag := $(shell echo ${gittag} | cut -d'.' -f 1)

docker/build:
	echo "Building ${tag}"
	docker build . -t ${name}:${tag}

docker/push: docker/build
	docker tag ${name}:${tag} ${name}:${basetag}
	docker push ${name}:${tag}
	docker push ${name}:${basetag}
